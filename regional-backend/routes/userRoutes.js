const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken'); // Required for the security check

// 1. Independent Security Middleware
const protect = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: "Not authorized!" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 
        next();
    } catch (error) {
        res.status(401).json({ message: "Invalid token!" });
    }
};

// 2. GET /api/users/search - Search patients by name or phone
router.get('/search', protect, async (req, res) => {
    try {
        // Security Check: Only clinicians and admins can search the database
        if (req.user.role === 'patient') {
            return res.status(403).json({ message: "Access Denied: Unauthorized role." });
        }

        // Get the search term from the URL
        const searchQuery = req.query.q;
        if (!searchQuery) {
            return res.status(400).json({ message: "Please provide a search term." });
        }

        console.log(`🔍 SEARCH INITIATED: Looking for "${searchQuery}"`);

        // Database Query
        const patients = await User.find({
            role: 'patient', // Ensure we only return patients
            $or: [
                { fullName: { $regex: searchQuery, $options: 'i' } },
                { phone: { $regex: searchQuery, $options: 'i' } }
            ]
        }).select('-password'); // Never send passwords to the frontend

        console.log(`✅ SEARCH COMPLETE: Found ${patients.length} matching patients.`);
        res.status(200).json(patients);

    } catch (error) {
        console.error("❌ Search Error:", error);
        res.status(500).json({ message: "Server error during search." });
    }
});

// 3. GET /api/users/doctors - Get all clinicians for the booking dropdown
router.get('/doctors', protect, async (req, res) => {
    try {
        // Find users who have the role of doctor or clinician
        // We only select fullName and _id to keep the payload lightweight and secure
        const doctors = await User.find({ role: { $in: ['doctor', 'clinician'] } }).select('fullName _id');
        
        if (!doctors || doctors.length === 0) {
            return res.status(404).json({ message: "No clinicians found." });
        }

        res.status(200).json(doctors);
    } catch (error) {
        console.error("❌ Fetch Doctors Error:", error);
        res.status(500).json({ message: "Server error fetching doctors." });
    }
});

module.exports = router;