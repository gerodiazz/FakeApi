import formidable from 'formidable';
import { copyFile, unlink } from 'fs/promises';
import {
  generateAccessToken,
  generateRefreshToken,
  decodeRefreshToken,
} from '../utils/jwt-authenticate.js';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';

export const verifyToken = (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  console.log(token)
  if (!token) {
    res.status(401).jsonp({ message: 'Token no proporcionado' });
    return null;
  }

  try {
    const user = jwt.verify(token, CONFIG.accessTokenSecret);
    return user;
  } catch (error) {
    res.status(403).jsonp({ message: 'Token inválido' });
    return null;
  }
};


const handleUploadFile = async (req, file) => {
  const uploadFolder = 'uploads';

  try {
    // Copy file from temp folder to uploads folder (not rename to allow cross-device link)
    await copyFile(file.filepath, `./public/${uploadFolder}/${file.originalFilename}`);

    // Remove temp file
    await unlink(file.filepath);

    // Return new path of uploaded file
    file.filepath = `${req.protocol}://${req.get('host')}/${uploadFolder}/${file.originalFilename}`;

    return file;
  } catch (err) {
    throw err;
  }
};

export const testHandler = (db, req, res) => {
  res.jsonp('Hello world!');
};

export const loginHandler = (db, req, res) => {
  const { username, email, password: pwd } = req.body;

  const user = db.data.users?.find(
    (u) => (u.username === username || u.email === email) && u.password === pwd
  );

  if (user && user.password === pwd) {
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const { password, ...userWithoutPassword } = user;

    res.jsonp({
      ...userWithoutPassword,
      accessToken,
      refreshToken,
    });
  } else {
    res.status(400).jsonp({ message: 'Username or password is incorrect!' });
  }
};

export const refreshTokenHandler = (req, res) => {
  const { token } = req.body;

  if (token) {
    try {
      const payload = decodeRefreshToken(token);
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      res.jsonp({
        accessToken,
        refreshToken,
      });
    } catch (error) {
      res.status(400).jsonp({ error });
    }
  } else {
    res.status(400).jsonp({ message: 'Refresh Token is invalid!' });
  }
};

export const registerHandler = (db, req, res) => {
  const { username, email, password } = req.body;
  const users = db.data.users;

  if (!password && (!email || !username)) {
    res.status(400).jsonp({ message: 'Please input all required fields!' });
    return;
  }

  const existUsername = users?.find((user) => username && user.username === username);

  if (existUsername) {
    res.status(400).jsonp({
      message: 'The username already exists. Please use a different username!',
    });
    return;
  }

  const existEmail = users?.find((user) => email && user.email === email);

  if (existEmail) {
    res.status(400).jsonp({
      message: 'The email address is already being used! Please use a different email!',
    });
    return;
  }

  let maxId = 0;
  for (let u of users) {
    if (u.id > maxId) {
      maxId = u.id;
    }
  }
  const newUser = { id: maxId + 1, ...req.body, role: 'user' };

  users?.push(newUser);
  db.write();

  res.jsonp(newUser);
};

export const uploadFileHandler = (req, res) => {
  if (req.headers['content-type'] === 'application/json') {
    res.status(400).jsonp({ message: 'Content-Type "application/json" is not allowed.' });
    return;
  }

  const form = formidable();

  form.parse(req, async (error, fields, files) => {
    let file = files.file;

    if (error || !file) {
      res.status(400).jsonp({ message: 'Missing "file" field.' });
      return;
    }

    try {
      file = await handleUploadFile(req, file);
      res.jsonp(file);
    } catch (err) {
      console.log(err);
      res.status(500).jsonp({ message: 'Cannot upload file.' });
    }
  });
};

export const uploadFilesHandler = (req, res) => {
  if (req.headers['content-type'] === 'application/json') {
    res.status(400).jsonp({ message: 'Content-Type "application/json" is not allowed.' });
    return;
  }

  const form = formidable({ multiples: true });

  form.parse(req, async (error, fields, files) => {
    let filesUploaded = files.files;

    if (error || !filesUploaded) {
      res.status(400).jsonp({ message: 'Missing "files" field.' });
      return;
    }

    // If user upload 1 file, transform data to array
    if (!Array.isArray(filesUploaded)) {
      filesUploaded = [filesUploaded];
    }

    try {
      // Handle all uploaded files
      filesUploaded = await Promise.all(
        filesUploaded.map(async (file) => {
          try {
            file = await handleUploadFile(req, file);
            return file;
          } catch (err) {
            throw err;
          }
        })
      );

      res.jsonp(filesUploaded);
    } catch (err) {
      console.log(err);
      res.status(500).jsonp({ message: 'Cannot upload files.' });
    }
  });
};


export const getCartHandler = (db, req, res) => {
  const user = verifyToken(req, res);
  if (!user) return;

  let cart = db.data.carts.find(cart => cart.userId === user.sub);

  if (!cart) {
    cart = { userId: user.sub, items: [] };
    db.data.carts.push(cart);
    db.write();
  }

  const cartWithProductDetails = cart.items.map(item => {
    const product = db.data.products.find(product => product.id === item.productId);
    return {
      ...product,
      cartQuantity: item.quantity
    };
  });

  res.jsonp({
    userId: cart.userId,
    items: cartWithProductDetails
  });
};

export const addToCartHandler = (db, req, res) => {
  const user = verifyToken(req, res);
  if (!user) return;

  const { productId, quantity } = req.body;
  let cart = db.data.carts.find(cart => cart.userId === user.sub);

  if (!cart) {
    cart = { userId: user.sub, items: [] };
    db.data.carts.push(cart);
  }

  const itemIndex = cart.items.findIndex(item => item.productId === productId);
  if (itemIndex > -1) {
    cart.items[itemIndex].quantity += quantity;
  } else {
    cart.items.push({ productId, quantity });
  }

  db.write();

  const cartWithProductDetails = cart.items.map(item => {
    const product = db.data.products.find(product => product.id === item.productId);
    return {
      ...product,
      cartQuantity: item.quantity
    };
  });

  res.jsonp({
    userId: cart.userId,
    items: cartWithProductDetails
  });
};

export const removeFromCartHandler = (db, req, res) => {
  const user = verifyToken(req, res);
  if (!user) return;

  const { productId, quantity } = req.body;
  const cart = db.data.carts.find(cart => cart.userId === user.sub);

  if (cart) {
    const itemIndex = cart.items.findIndex(item => item.productId === productId);
    if (itemIndex > -1) {
      if (quantity && cart.items[itemIndex].quantity > quantity) {
        cart.items[itemIndex].quantity -= quantity;
      } else {
        cart.items.splice(itemIndex, 1);
      }
      db.write();
      
      const cartWithProductDetails = cart.items.map(item => {
        const product = db.data.products.find(product => product.id === item.productId);
        return {
          ...product,
          cartQuantity: item.quantity
        };
      });
      
      res.jsonp({
        userId: cart.userId,
        items: cartWithProductDetails
      });
    } else {
      res.status(404).jsonp({ message: 'Producto no encontrado en el carrito' });
    }
  } else {
    res.status(404).jsonp({ message: 'Carrito no encontrado' });
  }
};

export const clearCartHandler = (db, req, res) => {
  const user = verifyToken(req, res);
  if (!user) return;

  const cart = db.data.carts.find(cart => cart.userId === user.sub);

  if (cart) {
    cart.items = [];
    db.write();
    res.jsonp(cart);
  } else {
    res.status(404).jsonp({ message: 'Carrito no encontrado' });
  }
};






export const socketEmit = (io, req, res) => {
  io.emit('socket-emit', req.body);
  res.jsonp({ msg: 'Message sent over websocket connection' });
};
