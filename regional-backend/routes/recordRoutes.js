const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); 
const Record = require('../models/Record');

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

// 2. GET /api/records/patient/:id - Fetch a patient's medical history
router.get('/patient/:id', protect, async (req, res) => {
    console.log(`📂 FETCHING HISTORY: Retrieving records for Patient ID: ${req.params.id}`);
    try {
        // Query MongoDB for records matching the patient ID, newest first
        const records = await Record.find({ patientId: req.params.id }).sort({ date: -1 });
        
        console.log(`✅ SUCCESS: Found ${records.length} past records.`);
        res.status(200).json(records);
    } catch (error) {
        console.error("❌ Fetch Records Error:", error);
        res.status(500).json({ message: "Server error fetching records." });
    }
});

// 3. GET /api/records/appointment/:appointmentId - Fetch a specific clinical record
router.get('/appointment/:appointmentId', protect, async (req, res) => {
    console.log(`📂 FETCHING RECORD: Retrieving record for Appointment ID: ${req.params.appointmentId}`);
    try {
        // Find the specific record tied to this appointment
        const record = await Record.findOne({ appointmentId: req.params.appointmentId });
        
        if (!record) {
            return res.status(404).json({ message: "Clinical record not found for this visit." });
        }

        // Security check: Ensure the logged-in patient actually owns this record
        if (req.user.role === 'patient' && record.patientId.toString() !== req.user.id) {
            console.log(`⛔ Unauthorized access attempt to record by user ${req.user.id}`);
            return res.status(403).json({ message: "Access Denied: You do not own this record." });
        }

        console.log(`✅ SUCCESS: Record found.`);
        res.status(200).json(record);
    } catch (error) {
        console.error("❌ Fetch Record Error:", error);
        res.status(500).json({ message: "Server error fetching medical record." });
    }
});

// 4. POST /api/records - Save a new eye exam
router.post('/', protect, async (req, res) => {
    try {
        if (req.user.role === 'patient') {
            return res.status(403).json({ message: "Only clinicians can save medical records." });
        }

        const newRecord = new Record({
            ...req.body,
            clinicianId: req.user.id 
        });

        await newRecord.save();
        console.log("🏥 CLINICAL RECORD SAVED for Patient ID:", req.body.patientId);
        res.status(201).json({ message: "Record saved successfully", record: newRecord });
    } catch (error) {
        console.error("❌ Record Save Error:", error);
        res.status(500).json({ message: "Server error saving record." });
    }
});

// THIS MUST ALWAYS BE THE VERY LAST LINE
module.exports = router;