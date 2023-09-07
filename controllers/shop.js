const fs = require('fs');
const path = require('path');
const pdfkit = require('pdfkit');
const Product = require('../models/product');
const Order = require('../models/order');
const User = require('../models/user');
const paypal = require('paypal-rest-sdk');
require('dotenv').config();
const paypalId = process.env.PAYPAL_ID;
const clientSecert = process.env.PAYPAL_SECERT;


const paypalConfigure = () => {
  paypal.configure({
    'mode': 'sandbox',
    'client_id': paypalId,
    'client_secret': clientSecert
  });
};
const ITEMS_PER_PAGE = 2;

exports.getProducts = (req, res, next) => {
  const page = +req.query.page || 1;
  let totalItems;
  Product.find()
    .countDocuments()
    .then(numProducts => {
      totalItems = numProducts;
      return Product.find()
        .skip((page - 1) * ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE);
    })
    .then(products => {
      res.render('shop/product-list', {
        prods: products,
        pageTitle: 'Products',
        path: '/',
        currentPage: page,
        hasNextPage: ITEMS_PER_PAGE * page < totalItems,
        hasPreviousPage: page > 1,
        nextPage: page + 1,
        previousPage: page - 1,
        lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE)
      });
    });

};

exports.getProduct = (req, res, next) => {
  const prodId = req.params.productId;
  Product.findById(prodId)
    .then(product => {
      res.render('shop/product-detail', {
        product: product,
        pageTitle: product.title,
        path: '/products'
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getIndex = (req, res, next) => {
  const page = +req.query.page || 1;
  let totalItems;
  Product.find()
    .countDocuments()
    .then(numProducts => {
      totalItems = numProducts;
      return Product.find()
        .skip((page - 1) * ITEMS_PER_PAGE)
        .limit(ITEMS_PER_PAGE);
    })
    .then(products => {
      res.render('shop/index', {
        prods: products,
        pageTitle: 'Shop',
        path: '/',
        currentPage: page,
        hasNextPage: ITEMS_PER_PAGE * page < totalItems,
        hasPreviousPage: page > 1,
        nextPage: page + 1,
        previousPage: page - 1,
        lastPage: Math.ceil(totalItems / ITEMS_PER_PAGE)
      });
    })
    .catch(err => {

      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getCart = (req, res, next) => {
  req.user
    .populate('cart.items.productId')
    .execPopulate()
    .then(() => {
      return Order.find({
        'user.userId': req.user._id,
        status: 'pending',
      });
    })
    .then((orders) => {
      const updatePromises = [];

      for (let order of orders) {
        for (let p of order.products) {
          for (let i = 0; i < p.quantity; i++) {
            updatePromises.push(req.user.addToCart(p.product));
          }
        }
        order.status = 'canceled';
        updatePromises.push(order.save());
      }

      return Promise.all(updatePromises);
    })
    .then(() => {
      return req.user.save();
    })
    .then(() => {
      return req.user.populate('cart.items.productId').execPopulate();
    })
    .then((user) => {
      res.render('shop/cart', {
        path: '/cart',
        pageTitle: 'Your Cart',
        products: user.cart.items,
      });
    })
    .catch((err) => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};


exports.postCart = (req, res, next) => {
  const prodId = req.body.productId;
  Product.findById(prodId)
    .then(product => {
      return req.user.addToCart(product);
    })
    .then(result => {
      res.redirect('/cart');
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.postCartDeleteProduct = (req, res, next) => {
  const prodId = req.body.productId;
  req.user
    .removeFromCart(prodId)
    .then(result => {
      res.redirect('/cart');
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getCheckout = (req, res, next) => {
  req.user
    .populate('cart.items.productId')
    .execPopulate()
    .then(user => {
      Order.findOne({ 'user.userId': user._id, status: 'pending' })
        .then(order => {
          if (!order) {
            res.render('shop/checkout', {
              path: '/checkout',
              pageTitle: 'Checkout',
              products: [],
              totalSum: 0
            });
            return;
          }

          let total = 0;
          const products = order.products.map(p => {
            total += p.quantity * p.product.price;
            return { productId: p.product, quantity: p.quantity };
          });

          res.render('shop/checkout', {
            path: '/checkout',
            pageTitle: 'Checkout',
            products: products,
            totalSum: total
          });
        })
        .catch(err => {
          const error = new Error(err);
          error.httpStatusCode = 500;
          next(error);
        });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      next(error);
    });
};

exports.postCheckout = (req, res, next) => {
  paypalConfigure();
  let total = 0;
  let orderId;

  User.findById(req.user._id)
    .then(user => {
      return Order.findOne({ 'user.userId': req.user._id });
    })
    .then(order => {
      const products = order.products;
      products.forEach(p => {
        total += p.quantity * p.product.price;
      });

      orderId = order._id;

      if (order.status !== 'canceled') {
        order.status = 'canceled';
        return Order.findByIdAndUpdate(order._id, order);
      }

      return order;
    })
    .then(() => {
      const paymentDetails = {
        "intent": "sale",
        "payer": {
          "payment_method": "paypal"
        },
        "redirect_urls": {
          "return_url": `http://localhost:3000/order/${orderId}`,
          "cancel_url": "http://localhost:3000/checkout/cancel"
        },
        "transactions": [{
          "amount": {
            "currency": "USD",
            "total": total.toString()
          },
          "description": "Paying my shop"
        }]
      };

      paypal.payment.create(paymentDetails, (error, payment) => {
        if (error) {
          throw error;
        } else {
          const approvalUrl = payment.links.find(link => link.rel === 'approval_url');
          res.json({ redirectUrl: approvalUrl.href });
        }
      });
    })
    .catch(err => {
      const error = new Error(err);
      return next(error);
    });
};


exports.postOrder = (req, res, next) => {
  req.user
    .populate('cart.items.productId')
    .execPopulate()
    .then(user => {
      const products = user.cart.items.map(i => {
        return { quantity: i.quantity, product: { ...i.productId._doc } };
      });

      const order = new Order({
        user: {
          email: req.user.email,
          userId: req.user._id
        },
        products: products
      });
      return order.save();
    })
    .then(result => {
      return req.user.clearCart();
    })
    .then(() => {
      res.redirect('/checkout');
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getPaymentStatus = (req, res, next) => {
  paypalConfigure();
  const paymentId = req.query.paymentId;
  const payerId = { payer_id: req.query.PayerID };
  const orderId = req.query.orderId;

  paypal.payment.execute(paymentId, payerId, (error, payment) => {
    if (error) {
      console.error(error);
      res.redirect('/checkout');
      return;
    }

    if (payment.state === "approved") {
      Order.findById(orderId)
        .then(order => {
          if (order) {
            order.status = 'paid';
            order.save()
              .then(() => res.redirect('/orders'))
              .catch(error => {
                console.error(error + 'ww');
                res.redirect('/checkout');
              });
          }
          else {
            console.warn("Payment was not approved:", payment);
            res.redirect('/checkout');
          }
        })
        .catch(error => {
          console.error(error);
          res.redirect('/checkout');
        });
    } else {
      res.redirect('/checkout');
    }
  });
};


exports.getOrders = (req, res, next) => {
  Order.find({ 'user.userId': req.user._id, status: 'paid' })
    .then(orders => {
      res.render('shop/orders', {
        path: '/orders',
        pageTitle: 'Your Orders',
        orders: orders
      });
    })
    .catch(err => {
      const error = new Error(err);
      error.httpStatusCode = 500;
      return next(error);
    });
};

exports.getInvoice = (req, res, next) => {
  const orderId = req.params.orderId;

  Order.findById(orderId).then(order => {
    if (!order) {
      return next(new Error('No order found'));
    }
    if (order.user.userId.toString() !== req.user._id.toString()) {
      return next(new Error('Unauthorized'));
    }
    const invoiceName = 'invoice-' + orderId + '.pdf';
    const invoicePath = path.join('data', 'invoices', invoiceName);
    const pdfDoc = new pdfkit();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + invoiceName + '"');

    pdfDoc.pipe(fs.createWriteStream(invoicePath));
    pdfDoc.pipe(res);
    pdfDoc.fontSize(26).text('Invoice', {
      underline: true
    });
    pdfDoc.text('-----------------');
    let totalPrice = 0;

    order.products.forEach(prod => {
      totalPrice += prod.product.price * prod.quantity;
      pdfDoc.fontSize(14).text(prod.product.title + '- ' + prod.quantity + 'x' + '$' + prod.product.price);
    });
    pdfDoc.text('-----');
    pdfDoc.fontSize(20).text('Total price: $' + totalPrice);

    pdfDoc.end();
  }).catch(err => console.log(err));
};
