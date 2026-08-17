const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Moved to the top for cleaner code
const { Parser } = require('json2csv'); 

// Import Models
const User = require('../models/User');
const Appointment = require('../models/Appointment'); 
const Payment = require('../models/Payment'); 
const Service = require('../models/Service'); 

// Import Utilities
const sendSMS = require('../utils/sms'); 

// ==========================================
// SECURITY MIDDLEWARE: Strictly Admins Only
// ==========================================
const protectAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: "Not authorized!" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: "Forbidden: Admins only." });
        }
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: "Invalid token!" });
    }
};

// ==========================================
// DASHBOARD STATS
// ==========================================

// GET /api/admin/stats - Fetch real-time dashboard data
router.get('/stats', protectAdmin, async (req, res) => {
    try {
        // 1. Count total patients in the database
        const totalPatients = await User.countDocuments({ role: 'patient' });

        // 2. Count today's scheduled appointments
        const today = new Date().toISOString().split('T')[0]; // Gets current date "YYYY-MM-DD"
        const todaysVisits = await Appointment.countDocuments({ date: today });

        // 3. Get all active staff members (Clinicians and Admins) to populate the table
        const staffList = await User.find({ role: { $in: ['clinician', 'admin'] } }).select('-passwordHash');

        // 4. Count missed appointments
        const missedAppts = await Appointment.countDocuments({ status: 'cancelled' });
        
        // 5. Count payments that are NOT completed
        const pendingPayments = await Payment.countDocuments({ status: { $ne: 'Completed' } });

        // Send the data package to the frontend
        res.status(200).json({
            totalPatients,
            todaysVisits,
            pendingPayments, 
            missedAppts,
            staffList
        });

    } catch (error) {
        console.error("Admin Stats Error:", error);
        res.status(500).json({ message: "Server error fetching admin stats." });
    }
});

// ==========================================
// STAFF MANAGEMENT
// ==========================================

// POST /api/admin/add-staff - Create a new clinician or admin account
router.post('/add-staff', protectAdmin, async (req, res) => {
    try {
        const { fullName, phone, role } = req.body;

        if (!['clinician', 'admin'].includes(role)) {
            return res.status(400).json({ message: "Invalid role specified." });
        }

        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ message: "A user with this phone number already exists in the system." });
        }

        // 1. Split the fullName to satisfy MongoDB schema requirements
        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || ' '; // Fallback if they only type one name

        // 2. Generate and hash the temporary password
        const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPassword, salt);

        // 3. Save the new staff member with all required fields
        const newStaff = new User({
            firstName: firstName,
            lastName: lastName,
            fullName: fullName,
            phone: phone,
            passwordHash: hashedPassword,
            role: role,
            isVerified: true // Crucial: Allows staff to bypass the OTP screen!
        });

        await newStaff.save();
        console.log(`✅ New staff created: ${fullName} (${role})`);

        // 4. Send the SMS credential
        const message = `Welcome to Regional Opticians, ${firstName}! Your ${role} account has been created. Your temporary login password is: ${tempPassword}`;
        
        try {
            await sendSMS(phone, message);
            console.log(`📩 Sent login credentials via SMS to ${phone}`);
        } catch(smsErr) {
            console.error("❌ Staff SMS Error:", smsErr.message);
        }

        res.status(201).json({ message: "Staff account created successfully!" });

    } catch (error) {
        // If this fails again, the exact Mongoose error will print in your VS Code terminal!
        console.error("❌ Add Staff Error:", error); 
        res.status(500).json({ message: "Server error creating staff account." });
    }
});

// PUT /api/admin/staff/:id - Edit an existing staff member
router.put('/staff/:id', protectAdmin, async (req, res) => {
    try {
        const { fullName, phone, role } = req.body;
        const staffId = req.params.id;

        if (!fullName || !phone || !role) {
            return res.status(400).json({ message: "All fields are required." });
        }

        const existingUser = await User.findOne({ phone, _id: { $ne: staffId } });
        if (existingUser) {
            return res.status(400).json({ message: "This phone number is already registered to another account." });
        }

        const updatedStaff = await User.findByIdAndUpdate(
            staffId,
            { fullName, phone, role },
            { new: true } 
        );

        if (!updatedStaff) {
            return res.status(404).json({ message: "Staff member not found." });
        }

        console.log(`✏️ Staff updated: ${fullName}`);
        res.status(200).json({ message: "Staff details updated successfully!" });

    } catch (error) {
        console.error("❌ Edit Staff Error:", error);
        res.status(500).json({ message: "Server error updating staff." });
    }
});

// DELETE /api/admin/staff/:id - Revoke staff access
router.delete('/staff/:id', protectAdmin, async (req, res) => {
    try {
        if (req.user.id === req.params.id) {
            return res.status(400).json({ message: "You cannot revoke your own admin access." });
        }

        const deletedStaff = await User.findByIdAndDelete(req.params.id);
        
        if (!deletedStaff) {
            return res.status(404).json({ message: "Staff member not found." });
        }

        console.log(`🛑 Staff access revoked for: ${deletedStaff.fullName}`);
        res.status(200).json({ message: "Staff access successfully revoked." });

    } catch (error) {
        console.error("❌ Revoke Staff Error:", error);
        res.status(500).json({ message: "Server error revoking staff access." });
    }
});

// ==========================================
// SERVICE MANAGEMENT
// ==========================================

// PUT /api/admin/update-price - Update a service price
router.put('/update-price', protectAdmin, async (req, res) => {
    try {
        const { serviceName, newPrice } = req.body;

        if (!serviceName || newPrice === undefined) {
            return res.status(400).json({ message: "Service name and new price are required." });
        }

        const updatedService = await Service.findOneAndUpdate(
            { name: serviceName }, 
            { price: newPrice }, 
            { new: true } 
        );

        if (!updatedService) {
            return res.status(404).json({ message: "Service not found in the database." });
        }

        console.log(`💰 Service price updated: ${serviceName} to Ksh ${newPrice}`);
        res.status(200).json({ 
            message: "Price updated successfully!", 
            service: updatedService 
        });

    } catch (error) {
        console.error("❌ Edit Price Error:", error);
        res.status(500).json({ message: "Server error updating price." });
    }
});

// ==========================================
// REPORTING & ANALYTICS
// ==========================================

// GET /api/admin/reports/patients - Generate a Summary CSV Report
router.get('/reports/patients', protectAdmin, async (req, res) => {
    try {
        const patients = await User.find({ role: 'patient' }).sort({ createdAt: -1 });

        if (patients.length === 0) {
            return res.status(404).json({ message: "No patients found to generate report." });
        }

        const fields = [
            { label: 'System ID', value: '_id' },
            { label: 'Patient Full Name', value: 'fullName' },
            { label: 'Registered Phone', value: 'phone' },
            { label: 'National ID Number', value: 'nationalId' },
            { label: 'Account Created Date', value: 'createdAt' }
        ];

        const json2csvParser = new Parser({ fields });
        const csvData = json2csvParser.parse(patients);

        res.header('Content-Type', 'text/csv');
        res.attachment('Regional_Opticians_Patient_Summary_Report.csv');
        res.status(200).send(csvData);

    } catch (error) {
        console.error("Report Generation Error:", error);
        res.status(500).json({ message: "Failed to generate summary report." });
    }
});

// GET /api/admin/reports/financials - Fetch financial reports (WITH PATIENT NAMES)
router.get('/reports/financials', protectAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = { status: 'Completed' }; 

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate + 'T23:59:59.999Z');
            
            // Check both date and createdAt to be bulletproof
            query.$or = [
                { date: { $gte: start, $lte: end } },
                { createdAt: { $gte: start, $lte: end } }
            ];
        }

        // Fetch payments using .lean() so we can inject new properties easily
        const payments = await Payment.find(query).sort({ createdAt: -1, date: -1 }).lean();
        
        // Extract all unique phone numbers from the transactions
        const uniquePhones = [...new Set(payments.map(p => p.phone).filter(Boolean))];
        
        // Search the User database for anyone matching these phone numbers
        const phoneRegexes = uniquePhones.map(p => new RegExp(`^\\+?${p.replace(/^\+/, '')}$`));
        const users = await User.find({ phone: { $in: phoneRegexes } }).lean();
        
        // Create a fast lookup map: phone -> fullName
        const phoneToNameMap = {};
        users.forEach(u => {
            const cleanPhone = u.phone.replace('+', '');
            phoneToNameMap[cleanPhone] = u.fullName;
            phoneToNameMap[u.phone] = u.fullName;
        });

        // Calculate total revenue and map the patient names onto the receipts
        let totalRevenue = 0;
        const enrichedPayments = payments.map(p => {
            totalRevenue += (p.amount || 0);
            const cleanPhone = p.phone ? p.phone.replace('+', '') : '';
            return {
                ...p,
                patientName: phoneToNameMap[p.phone] || phoneToNameMap[cleanPhone] || 'Walk-in / Unregistered'
            };
        });

        res.status(200).json({ 
            count: enrichedPayments.length, 
            totalRevenue, 
            payments: enrichedPayments 
        });

    } catch (error) {
        console.error("Report Error:", error);
        res.status(500).json({ message: "Server error fetching financial reports." });
    }
});

// GET /api/admin/reports/service-utilization - Fetch data for the Chart
router.get('/reports/service-utilization', protectAdmin, async (req, res) => {
    try {
        const serviceStats = await Appointment.aggregate([
            { $match: { status: { $ne: 'cancelled' } } }, 
            { 
                $group: {
                    _id: "$service", 
                    count: { $sum: 1 } 
                }
            },
            { $sort: { count: -1 } } 
        ]);

        res.status(200).json(serviceStats);

    } catch (error) {
        console.error("Service Report Error:", error);
        res.status(500).json({ message: "Server error fetching service utilization." });
    }
});

// GET /api/admin/reports/no-shows - Exception Report
router.get('/reports/no-shows', protectAdmin, async (req, res) => {
    try {
        const noShows = await Appointment.find({ status: 'cancelled' })
                                         .populate('patientId', 'phone')
                                         .sort({ date: -1 })
                                         .limit(20); 

        res.status(200).json(noShows);
    } catch (error) {
        console.error("No-Show Report Error:", error);
        res.status(500).json({ message: "Server error fetching no-shows." });
    }
});

// GET /api/admin/reports/pending-payments - Financial Exception Report
router.get('/reports/pending-payments', protectAdmin, async (req, res) => {
    try {
        // Fetch any payment that is NOT marked as "Completed"
        const pending = await Payment.find({ status: { $ne: 'Completed' } })
                                     .sort({ date: -1 })
                                     .limit(20);
        res.status(200).json(pending);
    } catch (error) {
        console.error("Pending Payments Error:", error);
        res.status(500).json({ message: "Server error fetching pending payments." });
    }
});

// GET /api/admin/reports/clinician-performance
router.get('/reports/clinician-performance', protectAdmin, async (req, res) => {
    try {
        const appointments = await Appointment.find({ status: { $ne: 'cancelled' } });

        const stats = {};

        appointments.forEach(appt => {
            const docName = (appt.doctor && appt.doctor !== 'Any available') 
                            ? appt.doctor 
                            : "Unassigned Patients";
            
            if (!stats[docName]) {
                stats[docName] = { name: docName, patientCount: 0, revenueGenerated: 0 };
            }
            
            stats[docName].patientCount += 1;
            stats[docName].revenueGenerated += (appt.price || 0); 
        });

        const performanceData = Object.values(stats);
        performanceData.sort((a, b) => b.patientCount - a.patientCount);

        res.status(200).json(performanceData);

    } catch (error) {
        console.error("Performance Report Error:", error);
        res.status(500).json({ message: "Error fetching performance stats." });
    }
});

module.exports = router;