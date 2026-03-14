const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { protect } = require ('../middleware/authMiddleware')

router.post('/register', register);
router.post('/login', login);

// Step 1: Google redirect
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
 
router.get('/me', protect, (req, res) => {
  res.json(req.user);
});

// Step 2: Google callback —create JWT and send frontend
router.get('/google/callback',
  passport.authenticate('google', { 
    failureRedirect: 'http://localhost:5173/login?error=google_failed', 
    session: false 
  }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.redirect(`http://localhost:5173/auth/callback?token=${token}`);
  }
);

module.exports = router;