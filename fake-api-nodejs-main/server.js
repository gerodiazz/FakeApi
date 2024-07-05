import { graphqlHTTP } from 'express-graphql';
import http from 'http';
import jsonServer from 'json-server';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Server } from 'socket.io';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';

import { CONFIG } from './config.js';
import { isAuthenticated, verifyToken } from './utils/jwt-authenticate.js';
import { schema, setupRootValue } from './src/graphql.js';
import {
  loginHandler,
  registerHandler,
  refreshTokenHandler,
  socketEmit,
  testHandler,
  uploadFileHandler,
  uploadFilesHandler,
  getCartHandler,
  removeFromCartHandler,
  clearCartHandler,
  addToCartHandler,
} from './src/rest.js';
import socketHandler from './src/socket-io.js';

const db = new Low(new JSONFile(CONFIG.databaseFile));
await db.read();

const app = jsonServer.create();
const router = jsonServer.router(CONFIG.databaseFile);
const middlewares = jsonServer.defaults();
const port = process.env.PORT || CONFIG.defaultPort;
const server = http.createServer(app);

// Init socket io server
const io = new Server(server, {
  cors: { origin: '*' },
});
io.on('connection', (socket) => {
  socketHandler(socket, io);
});

// Config proxy middlewares
app.use(
  CONFIG.proxyUrl,
  createProxyMiddleware({
    target: CONFIG.proxyServer,
    changeOrigin: true,
    ws: true,
    logger: console,
    onProxyRes: function (proxyRes, req, res) {
      cors()(req, res, () => {
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = '*';
      });
    },
  })
);






// Init graphql
app.use('/graphql', graphqlHTTP({ schema, rootValue: setupRootValue(db), graphiql: true }));

// Set default middlewares (logger, static, cors and no-cache)
app.use(middlewares);

// Handle POST, PUT and PATCH request
app.use(jsonServer.bodyParser);

// Save createdAt and updatedAt automatically
app.use((req, res, next) => {
  const currentTime = Date.now();

  if (req.method === 'POST') {
    req.body.createdAt = currentTime;
    req.body.modifiedAt = currentTime;
  } else if (['PUT', 'PATCH'].includes(req.method)) {
    req.body.modifiedAt = currentTime;
  }

  next();
});

// Test web socket request
app.post('/socket-emit', (req, res) => {
  socketEmit(io, req, res);
});

// Test request (change the response in src/rest.js)
app.get('/test', (req, res) => {
  testHandler(db, req, res);
});

// Register request
app.post('/register', (req, res) => {
  registerHandler(db, req, res);
});

// Login request
app.post('/login', (req, res) => {
  loginHandler(db, req, res);
});

// Renew Token request
app.post('/refresh-token', (req, res) => {
  refreshTokenHandler(req, res);
});

app.get('/cart', (req, res) => getCartHandler(db, req, res));
app.post('/cart', (req, res) => addToCartHandler(db, req, res));
app.delete('/cart', (req, res) => removeFromCartHandler(db, req, res));
app.delete('/cart/clear', (req, res) => clearCartHandler(db, req, res));

// Upload 1 file
app.post('/upload-file', uploadFileHandler);

// Upload multiple files
app.post('/upload-files', uploadFilesHandler);

app.use((req, res, next) => {
  const protectedResources = db.data.protectedResources;
  if (!protectedResources) {
    next();
    return;
  }

  const resource = req.path.slice(1).split('/')[0];
  const method = req.method.toUpperCase();
  
  if (resource === 'products' && method === 'GET') {
    next();
    return;
  }

  const checkAccess = (role) => {
    const protectedResource = protectedResources[resource]?.[role]?.map(item => item.toUpperCase());
    return protectedResource && protectedResource.includes(method);
  };

  const user = verifyToken(req, res);

  if (!user) return;

  if (checkAccess('user') && user.role.toLowerCase() === 'user') {
    next();
  } else if (checkAccess('admin') && user.role.toLowerCase() === 'admin') {
    next();
  } else if (checkAccess('superadmin') && user.role.toLowerCase() === 'superadmin') {
    next();
  } else {
    res.sendStatus(401);
  }
});



// Rewrite routes
const urlRewriteFile = new JSONFile(CONFIG.urlRewriteFile);
const rewriteRules = await urlRewriteFile.read();
app.use(jsonServer.rewriter(rewriteRules));

// Setup others routes
app.use(router);

// Start server
server.listen(port, () => {
  console.log('Server is running on port ' + port);
});
