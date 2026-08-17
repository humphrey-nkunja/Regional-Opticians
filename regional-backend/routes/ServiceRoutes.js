const express = require('express');
const router = express.Router();
const Service = require('../models/Service');

// 1. GET ALL SERVICES (Publicly accessed by both Admin and Patient dashboards)
router.get('/', async (req, res) => {
    try {
        let services = await Service.find({});
        
        // Auto-seed the database if it is completely empty!
        if (services.length === 0) {
            const defaults = [
                { name: "Comprehensive Eye Exam", price: 3000 },
                { name: "Contact Lens Fitting", price: 3500 },
                { name: "Frame Fitting", price: 1500 },
                { name: "Pediatric Eye Exam", price: 2500 },
                { name: "Follow-up Consultation", price: 1000 },
                { name: "General Consultation", price: 2000 }
            ];
            services = await Service.insertMany(defaults);
        }
        res.status(200).json(services);
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});

// 2. UPDATE PRICES (Admin Only)
router.put('/update', async (req, res) => {
    try {
        const { services } = req.body;
        
        // Loop through the submitted prices and update MongoDB
        for (const [name, price] of Object.entries(services)) {
            await Service.findOneAndUpdate(
                { name: name }, 
                { price: price }, 
                { upsert: true } // Creates it if it doesn't exist
            );
        }
        res.status(200).json({ message: "Prices updated successfully!" });
    } catch (error) {
        res.status(500).json({ message: "Failed to update prices" });
    }
});

module.exports = router;