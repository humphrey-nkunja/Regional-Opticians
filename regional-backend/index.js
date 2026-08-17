require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors'); // 1. Import the CORS package

// --- START THE BACKGROUND REMINDER SERVICE ---
require('./cronJobs'); 

const app = express();

// --- 2. MIDDLEWARE ---
app.use(cors()); // 2. Enable CORS for all routes (Crucial for Rescheduling/PUT)
app.use(express.json()); 

// --- 3. SERVE FRONTEND FILES ---
app.use(express.static('public')); 

// --- 4. IMPORT & LINK ROUTES ---
const authRoutes = require('./routes/authRoutes');
const recordRoutes = require('./routes/recordRoutes');
const userRoutes = require('./routes/userRoutes'); 
const adminRoutes = require('./routes/adminRoutes'); 
const mpesaRoutes = require('./routes/mpesaRoutes'); 
const serviceRoutes = require('./routes/serviceRoutes'); // NEW: Import Service routes

app.use('/api/auth', authRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/appointments', require('./routes/appointmentRoutes'));
app.use('/api/users', userRoutes); 
app.use('/api/admin', adminRoutes); 
app.use('/api/mpesa', mpesaRoutes); 
app.use('/api/services', serviceRoutes); // NEW: Link the Service route to the API gateway

// --- 5. CONNECT TO MONGODB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB successfully!'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// --- 6. START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});