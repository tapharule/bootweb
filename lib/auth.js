/*

Bootweb - boot your web app
Copyright (C) $year Nicolas Karageuzian

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

*/

/**
 * This module provides services for authentication
 */

var crypto = require('crypto'),
  mongoose = require('mongoose'),
  bootweb = require('./bootweb.js'),
  conn = bootweb.getConnection(),
  nconf = require('nconf'),
  passport = require("passport"),
  LocalStrategy = require('passport-local').Strategy,
  User = conn.model('User'),
  _ = require('util'),
  swig = require('swig'),
  plugins = [],
  authModule = {},
  logger = bootweb.getLogger("bootweb.auth"),
  express = require('express'),
  cookieParser = express.cookieParser;
passport.serializeUser(function(user, done) {
  done(null, user.id.toString());
});
passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    //logger.debug("Deserialise findById : " + _.inspect(arguments));
    done(err, user);
  });
});
passport.use('bootweb',new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
},

function(email, password, done) {
  // asynchronous verification, for effect...
  process.nextTick(function() {

    // Find the user by username. If there is no user with the given
    // username, or the password is not correct, set the user to `false` to
    // indicate failure and set a flash message. Otherwise, return the
    // authenticated `user`.
    User.findOne({
      email: email
    }, function(err, user) {
      if (err) {
        return done(err);
      }
      if (!user) {
        return done(null, false, {
          message: 'Unkown user ' + email
        });
      }
      if (!user.validPassword(password)) {
        return done(null, false, {
          message: 'Invalid password'
        });
      }
      return done(null, user);
    })
  });
}));


authModule.init = function() {
  bootweb.on("ready", function() {
    /*
    bootweb.io.set("authorization", passportSocketIo.authorize({
      sessionStore: bootweb.dbStore,
      sessionSecret: 'super secret',
      sessionKey: 'connect.sess',
      fail: function(data, accept) { // *optional* callbacks on success or fail
      console.log(data);
        accept(null, false); // second param takes boolean on whether or not to allow handshake
      },
      success: function(data, accept) {
        console.log(data);
        accept(null, true);
      }
    })); 
    */
    bootweb.io.set('authorization', function (data, accept) {
      logger.info("Entering IO auth event");
      //logger.debug(_.inspect(arguments));
      //logger.debug(_.inspect(socket.manager.handshaken[socket.id]));
      //var data = socket.manager.handshaken[socket.id];
      if (data.headers.cookie) {

        //data.cookie = parseCookie(data);
        //data.sessionID = data.cookie['bootweb.sid'];
        cookieParser('super secret')(data, null, function(err) {
          //logger.debug("parse cookies : " + _.inspect(arguments));
          //logger.debug(data);
          var sessionID = data.signedCookies['bootweb.sid'];// data.cookies;
          logger.info("Socket sessionID: " + sessionID);
          // (literally) get the session data from the session store
          bootweb.sessions.get(sessionID, function(err, session) {
            //logger.debug(arguments);
            if (err || !session) {
              //throw err;
              // if we cannot grab a session, turn down the connection
              accept(err, false);
              logger.info("io session False");
            }
            else {
              // save the session data and accept the connection
              data.session = session;
              // deserialize passport user
               User.findById(session.passport.user, function(err, user) {
                data.user = user;
                logger.info("io session Ok");
                logger.debug("io session : "+_.inspect({
                  iosession: session,
                  iouser: user
                })); 
              });
              accept(null, true);                
            }
          });
        });
      }
      else {
        logger.info("io session False");
        return accept('No cookie transmitted.', false);
      }
    });
    bootweb.io.sockets.on("connection", function(socket) {
      //logger.debug(_.inspect(socket));
       if (socket.handshake.user != null) {
        logger.info("user connected: ", socket.handshake.user.pseudo);
        socket.emit('userInfo', {pseudo:socket.handshake.user.pseudo,email:socket.handshake.user.email});
       } else {
         logger.info("user not connected");
       }
    });
  });
  // Configure plugins
  if (nconf.get("auth:facebook") === true) {
    logger.info("Loading facebook auth");
    plugins.push(require("./external/facebook"));
  }
  plugins.forEach(function(plugin) {
    if (typeof plugin.init === "function") {
      plugin.init();
    }
  });
};
/**
 * Create a user
 */

authModule.createUser = function createUser(email, pseudo, password, callback) {
  var user = new User({
    email: email,
    pseudo: pseudo
  });
  user.setPassword(password);
  user.save(function(err) {
    if (err !== null) {
      if (typeof callback === "function") {
        return callback(err);
      }
    }
    bootweb.ACL.addUserRole(user, "everyone", function(err, newUserRole) {
      if (err !== null) {
        if (typeof callback === "function") {
          return callback(err);
        }
      }
      if (typeof callback === "function") {
        return callback(null, user);
      }
    });
  });
}
/**
 * Explicitely named, check for a user existence with specified email value,
 * if no matching user found, creates user with given password.
 * @param cb callback function (err, user)
 */
authModule.findOrCreateUser = function(username, pseudo, password, cb) {
  User.findOne({
    email: username
  }, function(err, user) {
    if (err !== null) {
      if (typeof cb === "function") {
        return cb(err);
      }
    }
    if (user === null) {
      logger.info(username + " user not found, creating");
      authModule.createUser(username, pseudo, password, cb);
    }
    else {
      logger.info(username + " user found");
      if (typeof cb === "function") {
        return cb(null, user, true);
      }
    }
  });
};
authModule.initUsers = function(callback) {
  logger.info("Starting initUsers");
  authModule.findOrCreateUser("admin", "admin", "demo", function(err, admin) {
    bootweb.ACL.addUserRole(admin, "admin");
    authModule.findOrCreateUser("anonymous", "anonymous", "anonymous");
    callback(null);
  });
};

/**
 * Simplist middleware for anonymous
 */
authModule.anonyMw = function(req, res, next) {
  if (req.user === undefined) {
    logger.info("No user connected, setting anonymous");
    User.findOne({
      email: "anonymous"
    }, function(err, user) {
      req.user = user;
      req.user.session = req.session.id;
      next();
    });
  }
  else {
    req.user.session = req.session.id;
    next();
  }
};
/**
 * Allows dev to check ACL for a route :
 *
 * app.get('url',bootweb.auth.verify("read"), function(req,res,next){res.send("allowed");})
 */
authModule.verify = function(authorization) {
  return function(req, res, next) {
    var authRequested = authorization;
    logger.warn("Entering auth check");
    var path = decodeURIComponent(req.path.replace(/\++/g, ' '));
    if (authRequested === null || authRequested === undefined) { // no parameter given, last part of path used as auth :
      logger.debug("Authorization param is null, splitting path : " + path);
      authRequested = path.substr(path.lastIndexOf("/") + 1);
      path = path.substr(0, path.lastIndexOf("/"));
    }
    logger.debug(_.inspect({
      authorisation: authRequested,
      email: req.user.email,
      path: path
    }));

    bootweb.ACL.isAuthorized(req.user.email, path, authRequested, function(err, isAuth) {
      if (err !== null) {
        return bootweb.renderError(req, res, {
          err: err,
          code: 500
        });
      }
      if (isAuth) {
        return next();
      }
      if (typeof req.user._id === "undefined") { //if anonymous, 401 Unauthorized
        return bootweb.renderError(req, res, {
          err: "Unauthorized",
          code: 401
        });
      }
      // if user connected, 403 Forbidden
      return bootweb.renderError(req, res, {
        err: "Forbidden",
        code: 403
      });
    });
  }
};



/**
 * Registers a user
 */
authModule.registerUser = function registerUser(email, pseudo, password, host, callback) {
  this.findOrCreateUser(email, pseudo, password, function(err, user,existing) {
    if (err != null) {
    	return callback(err);
    }
    if (existing) {
    	err = {code : 1100};
    }
    bootweb.ACL.addUserRole(user, "registered");
    var
    key = crypto.createHash('md5').update(
    (new Date()).valueOf().toString() + Math.random().toString()).digest('hex'),
      emailhash;
    user.key = key;
    user.save(function(err) {
      callback(err, user);
      try {
        var mailTpl = swig.compileFile("mail.html");
        emailhash = crypto.createHash('md5').update(user.email).digest('hex');
        var vallink = "http://" + host + "/activate/" + user.key + "/" + emailhash;
        bootweb.sendMail({
          text: "I hope",
          from: nconf.get('email:template:system:from'),
          to: user.email,
          //cci:     nconf.get('email:template:system:cci'),
          subject: "Activate your account",
          attachment: [{
            data: mailTpl.render({
              but: "Activer votre compte",
              texte: "activer votre compte",
              lien: vallink //
            }),
            alternative: true
          }]
        }, function(err) {
          if (err !== null) {
            logger.error("Validation mail not sent " + vallink);
            logger.info(_.inspect(err));
          }
        });
      }
      catch (e) {
        logger.error("Validation mail not sent" + vallink);
        logger.error(_.inspect(e));
      }
    });

    /*
     */
  });
};

/**
 * mapping urls for basic HTTP login/logout services
 */
authModule.mapUrls = function(app) {
  app.get('/logout', function(req, res) {
    req.logOut();
    res.redirect("back");
  });
  app.post('/register', function(req, res, next) {

    if (req.is('json')) {
      authModule.registerUser(req.body.email, req.body.pseudo, req.body.password, req.headers['host'], function(err, user) {
        if (err == null) {
          res.json({
            success: true,
            message: "user created, email sent"
          });
        }
        else {
          res.statusCode = 500;
          res.json({
            success: false,
            err: err
          });
        }
      });
    }
    else {
      authModule.registerUser(req.body.email, req.body.pseudo, req.body.password, req.headers['host'], function(err, user) {
        var redirectUrl = "back";
        if (typeof req.body.redirect === "string" && req.body.redirect !== "") {
          redirectUrl = req.body.redirect;
        }
        if (err == null) {
          if (typeof req.body.validationData === "string" && req.body.validationData != "") {
            user.validationData = req.body.validationData;
            user.save();
          }
          logger.info("Creation successful, forwarding to " + redirectUrl);
          res.redirect(redirectUrl);
          res.end();
          //res.send("<script>document.location = '"+redirectUrl + "'</script>");
        }
        else {
          if (err.code === 11000) {
            return bootweb.renderError(req, res, {
              err: "L'email est déjà enregistré, un nouveau mail de confirmation est envoyé [" +_.inspect(err),
              code: 500
            });

          }
          return bootweb.renderError(req, res, {
            err: 'Erreur inconnue <span style="display:none"' + _.inspect(err) + '</span>',
            code: 500
          });
        }
        //next();
      });
    }
  });
  app.get("/activate/:key/:emailHash", function(req, res, next) { // trame très (très) rapide
    // Faire éventuellement des vérifications, templater les pages d'erreur
    // Améliorer les messages
    User.findOne({
        key: req.params.key
    }, function(err, user) {
      var emailHash, validationData = ['render', 'activate.html'];
      if (user === null) {
        return bootweb.renderError(req, res, {
					err: "User not found",
					code: 404
				});
      }
      emailHash = crypto.createHash('md5').update(user.email).digest('hex');
      if (emailHash === req.params.emailHash) {
        // user validé
        user.active = true;
        user.key = "";
        user.save(function(err) {
          if (err != null) {
            return bootweb.renderError(req, res, {
							err: "Error saving user",
							code: 500
						});
          }
          if (typeof user.validationData === "string" && user.validationData !== "") {
            validationData = user.validationData.split(":");
          }
          if (validationData[0] === "render") {
            res.send(bootweb.swig.compileFile(validationData[1]).render({
              user: req.user
            }));
          }
          if (validationData[0] === "redirect") {
            res.redirect(301, validationData[1]);
          }
          // TODO: In register, handles a redirect parameter or a template parameter.
          // Store this data and retrieve at this point. This way, the developer just
          // have to specify this action behavior in it's front-end.
        });
      }
      else {
        return bootweb.renderError(req, res, {
          err: 'Erreur de validation <span style="display:none"' + _.inspect(err) + '</span>',
          code: 500
        });
      }
    });
  });
  app.post('/login', function(req, res, next) {
    passport.authenticate('bootweb', function(err, user, info) {
      logger.info("authenticate : err : " + _.inspect(err));
      logger.info("authenticate : user : " + _.inspect(user));
      logger.info("authenticate : info : " + _.inspect(info));
      if (err !== null) {
        res.json({
          success: false,
          message: "error",
          err: err
        });
      }
      if (user === null) {
        //req.flash('error', info.message);
        return bootweb.renderError(req, res, {
          err: "unknown user",
          code: 403
        });
      }
      req.logIn(user, function(id, err) {
        logger.info("logIn : id : " + _.inspect(id));
        logger.info("logIn : arguments : " + _.inspect(arguments));
        if (err) {
          return next(err);
        }
        if (req.is('json')) {
          return res.json({
            success: true
          });
        }
        return res.redirect(req.header('Referer'));
      });
    })(req, res, next);
  });
  plugins.forEach(function(plugin) {
    if (typeof plugin.mapUrls === "function") {
      plugin.mapUrls(app);
    }
  });

logger.info("Authentication API mapping terminated")
};
/*
    app.get('/login', function(req, res, next) {
        res.render("login.html",{});
    });
    */
module.exports = authModule;