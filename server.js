const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const session = require('express-session');
const passport = require('./config/passport');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const app = express();

const corsOptions = {
  origin: [
    'http://localhost:5173',
    'https://arch-flow-mu.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); 

app.use(express.json());

app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/renders', require('./routes/renders'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));