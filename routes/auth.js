const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { protect } = require ('../middleware/authMiddleware')
const { validate, userSchema, loginSchema } = require('../middleware/userValidation')

router.post('/register', validate(userSchema), register);
router.post('/login', validate(loginSchema), login);

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
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_failed`,
    session: false 
  }),
  (req, res) => {
    const token = jwt.sign(
      { id: req.user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  }
);

module.exports = router;