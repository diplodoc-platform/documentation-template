const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const chokidar = require('chokidar'); 
const express = require('express');
const serveStatic = require('serve-static');

const {parse, serialize} = require('parse5');
const utils = require('parse5-utils');

const watcher = new chokidar.FSWatcher({ignored: '*.swp'});
const glob = require('glob');

class Server {
  // read configuration
  constructor(parameters = {}) {
    const {
      watchPattern = 'docs/**/*',

      port = 8000,

      serveIndexes = ['index.html'],
      serveDir = 'docs-html',
      cacheControl = false,

      ssePath = '/events',
      sseEventName = 'reload',
      sseEventMessage = 'rebuilt'
    } = parameters;

    this.configs = {
      watchPattern,

      port,

      serveIndexes,
      serveDir,
      cacheControl,

      ssePath,
      sseEventName,
      sseEventMessage,
    };

    this.configs.sseScript = `
const events = new EventSource("${this.configs.ssePath}");

events.addEventListener("${this.configs.sseEventName}", function(e) {
  window.location.reload();
});
`;

    this.configure();
  }

  // configure server  
  configure() {
    this.app = express();
    this.app.use(serveStatic(this.configs.serveDir, {
      index: this.configs.serveIndexes,
      cacheControl: this.configs.cacheControl,
    }));
    this.app.get(this.configs.ssePath, this.sseRequestHandler.bind(this));
    this.sseResponseMessage = `event: ${this.configs.sseEventName}\ndata: ${this.configs.sseEventMessage}\n\n`;

    this.buildDocumentation();
    this.injectSSE();

    watcher.add(this.configs.watchPattern);
  }

  // handle sse request
  sseRequestHandler(req, res, next) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.flushHeaders();

    // when sources change:
    // - rebuild documentation
    // - notify client with reload event
    // this.watcher.on('all', (e) => {
    watcher.on('all', (event, path) => {
      console.info(`event: ${event}, path: ${path}`);
      
      this.buildDocumentation();
      this.injectSSE();
      this.sendSSEReloadResponse(res);
    });
  }

  // build documentation
  buildDocumentation() {
    console.info('building documentation');

    execSync('npm run build:docs');
  }

  injectSSE() {
    console.info('injecting sse into html');

    const pattern = path.join(this.configs.serveDir, '**', '*.html');
    const paths = glob.globSync(pattern, {ignore: 'node_modules/**'}).map(p => path.join(process.cwd(), p));
  
    for (const path of paths) {
      try {
        const html = fs.readFileSync(path, 'utf8');
        const transformed = this.injectSSEIntoHTML(html, this.configs.sseScript);
        fs.writeFileSync(path, transformed, {encoding: 'utf8'});
      } catch (err) {
        process.exit(1);
      }
    }
  }

  // send sse reload message
  sendSSEReloadResponse(res) {
    console.info('sending sse event');

    res.write(this.sseResponseMessage);
  }

  injectSSEIntoHTML(html, sse) {
    const parsed = parse(html);

    traverse(parsed, (node) => {
      if (node.nodeName === 'head') {
        const sseScript = utils.createNode('script');
        const sseScriptBody = utils.createTextNode(sse);

        utils.append(sseScript, sseScriptBody);
        utils.append(node, sseScript);
      }
    });

    return serialize(parsed);
  }

  // start up server
  listen() {
    this.app.listen(this.configs.port);
  }
}

function traverse(node, cb) {
  cb(node);

  const childNodes = node['childNodes'];
  if (!childNodes) {
    return ;
  }

  for (const childNode in childNodes) {
    traverse(childNodes[childNode], cb);
  }
}

const server = new Server();
server.listen();
