const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Appointment = require('../models/Appointment');
const User = require('../models/User'); 
const sendSMS = require('../utils/sms'); 

// Middleware to verify token
const protect = (req, res, next) => {
    console.log("🛡️ SECURITY CHECK: Verifying token...");
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        console.log("❌ ACCESS DENIED: No token found.");
        return res.status(401).json({ message: "Not authorized!" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 
        console.log("✅ TOKEN VALID: User ID", decoded.id);
        next();
    } catch (error) {
        res.status(401).json({ message: "Invalid token!" });
    }
};

// 1. POST /api/appointments/book (Patient Booking) - SPAM BLOCKER UPDATED
router.post('/book', protect, async (req, res) => {
    try {
        // --- THE SPAM BLOCKER: Limit Active Appointments ---
        // Check if the user already has a pending OR scheduled appointment
        const existingAppointment = await Appointment.findOne({
            patientId: req.user.id,
            status: { $in: ['pending', 'scheduled'] } // Blocks if pending or scheduled
        });

        if (existingAppointment) {
            console.log(`🛑 SPAM BLOCKED: User ${req.user.id} tried to book multiple times.`);
            return res.status(400).json({ 
                message: "You already have an active or pending appointment. Please attend or cancel it before booking a new one." 
            });
        }
        // --------------------------------------------------

        const { service, date, time, doctor } = req.body;
        const newAppointment = new Appointment({
            patientId: req.user.id,
            service, date, time, doctor
            // Note: status defaults to 'pending' as per the updated model!
        });
        await newAppointment.save();

        // 🌟 WOW FACTOR: Instant SMS upon booking (Pending Notification)
        const user = await User.findById(req.user.id);
        if (user && user.phone) {
            const firstName = user.firstName || user.fullName.split(' ')[0];
            const msg = `Regional Opticians: Hello ${firstName}, your appointment request for ${date} at ${time} has been received and is Pending Approval. We will notify you once confirmed.`;
            
            await sendSMS(user.phone, msg).catch(err => console.error("Booking SMS failed:", err.message));
        }

        res.status(201).json({ message: "Booked successfully! Pending approval.", appointment: newAppointment });
    } catch (error) {
        res.status(500).json({ message: "Server error." });
    }
});

// 2. GET /api/appointments/my-appointments (Patient Dashboard)
router.get('/my-appointments', protect, async (req, res) => {
    try {
        const appointments = await Appointment.find({ patientId: req.user.id }).sort({ date: 1 });
        res.status(200).json(appointments);
    } catch (error) {
        res.status(500).json({ message: "Server error." });
    }
});

// --- NEW: DYNAMIC SCHEDULING ROUTES ---

// 3. GET /api/appointments/clinicians - Fetch all available clinicians
router.get('/clinicians', protect, async (req, res) => {
    try {
        // Fetch users who are clinicians, sending back only their names
        const clinicians = await User.find({ role: 'clinician' }).select('fullName _id');
        res.status(200).json(clinicians);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch clinicians." });
    }
});

// 4. GET /api/appointments/booked-times - Duration Aware Availability Checker
router.get('/booked-times', protect, async (req, res) => {
    try {
        const { date, doctor, excludeId } = req.query;
        if (!date || !doctor) return res.status(400).json({ message: "Date and doctor required" });
        
        let query = { date: date, doctor: doctor };
        
        // If rescheduling, ignore the current appointment's held time
        if (excludeId && excludeId !== 'null') {
            query._id = { $ne: excludeId };
        }

        // Find ALL appointments for this doctor on this date
        const allAppointments = await Appointment.find(query);
        
        // Filter out cancelled ones using native JS (Pending appointments STILL block time slots!)
        const activeAppointments = allAppointments.filter(app => app.status !== 'cancelled');
        
        // Define the master schedule sequence
        const allTimeSlots = [
            "09:00 AM", "09:30 AM", "10:00 AM", "10:30 AM", 
            "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM",
            "02:00 PM", "02:30 PM", "03:00 PM", "03:30 PM", "04:00 PM"
        ];

        let bookedTimes = [];
        
        activeAppointments.forEach(app => {
            // Count how many services were booked (each takes 1 slot of 30 mins)
            const numServices = app.service ? app.service.split(', ').length : 1;
            const startIndex = allTimeSlots.indexOf(app.time);
            
            if (startIndex !== -1) {
                // Loop forward to block out consecutive 30-min chunks based on duration
                for (let i = 0; i < numServices; i++) {
                    if (allTimeSlots[startIndex + i]) {
                        bookedTimes.push(allTimeSlots[startIndex + i]);
                    }
                }
            }
        });
        
        // Remove duplicate times (just in case) and return
        res.status(200).json([...new Set(bookedTimes)]);
    } catch (error) {
        console.error("Availability Check Error:", error);
        res.status(500).json({ message: "Failed to fetch availability." });
    }
});

// --- CLINICIAN ROUTES ---

// 5. GET /api/appointments/all (Clinician Dashboard)
router.get('/all', protect, async (req, res) => {
    console.log("☎️ HEARTBEAT: Reached the correct /all route!");
    try {
        if (req.user.role === 'patient') return res.status(403).json({ message: "Access Denied" });
        
        const currentUser = await User.findById(req.user.id);
        const requestedDate = req.query.date;

        let query = { date: requestedDate };
        if (req.user.role === 'clinician') {
            // Case-insensitive regex match for the doctor's name
            query.doctor = { $regex: new RegExp(`^${currentUser.fullName}$`, 'i') };
        }
        
        const appointments = await Appointment.find(query)
            .populate('patientId', 'firstName lastName fullName phone')
            .sort({ time: 1 });

        res.status(200).json(appointments);
    } catch (error) {
        console.error("‼️ CRITICAL ROUTE ERROR:", error.stack);
        res.status(500).json({ message: "Internal Error" });
    }
});

// 6. POST /api/appointments/manual-sms (Clinician Alert Button)
router.post('/manual-sms', protect, async (req, res) => {
    console.log(`📩 SMS REQUEST: Sending alert to ${req.body.phone}`);
    try {
        if (req.user.role === 'patient') {
            return res.status(403).json({ message: "Unauthorized" });
        }
        
        // This calls the Africa's Talking utility you built
        await sendSMS(req.body.phone, req.body.message);
        
        console.log("✅ SMS Sent Successfully");
        res.status(200).json({ message: "Alert sent!" });
    } catch (error) {
        console.error("❌ SMS Error:", error.message);
        res.status(500).json({ message: "Failed to send SMS." });
    }
});

// 7. PATCH /api/appointments/:id/status (Clinician Check-In/Cancel/APPROVE)
router.patch('/:id/status', protect, async (req, res) => {
    console.log(`🔄 STATUS UPDATE: Changing appointment ${req.params.id} to ${req.body.status}`);
    try {
        if (req.user.role === 'patient') {
            return res.status(403).json({ message: "Unauthorized" });
        }
        
        const { status, reason } = req.body;

        // POPULATE added here to grab the patient's phone number and name
        const appointment = await Appointment.findByIdAndUpdate(
            req.params.id, 
            { status: status }, 
            { new: true }
        ).populate('patientId', 'firstName lastName fullName phone');
        
        if (!appointment) return res.status(404).json({ message: "Appointment not found" });

        // --- AUTOMATED SMS TRIGGERS ---
        if (appointment.patientId && appointment.patientId.phone) {
            const firstName = appointment.patientId.firstName || appointment.patientId.fullName.split(' ')[0];
            let smsMsg = "";

            if (status === 'cancelled') {
                // INJECT CANCELLATION REASON IF PROVIDED
                const reasonText = reason ? ` Reason: ${reason}.` : '';
                smsMsg = `Regional Opticians: Hello ${firstName}, unfortunately your appointment on ${appointment.date} at ${appointment.time} has been cancelled.${reasonText} Please call us to reschedule.`;
            } else if (status === 'scheduled') {
                // Triggered when a clinician APPROVES a pending appointment
                smsMsg = `Regional Opticians: Hello ${firstName}! Your appointment for ${appointment.date} at ${appointment.time} has been APPROVED. Please log into your portal to process payment.`;
            }

            if (smsMsg) {
                try {
                    await sendSMS(appointment.patientId.phone, smsMsg);
                    console.log(`✅ Automated Status SMS sent to ${appointment.patientId.phone}`);
                } catch (smsErr) {
                    console.error("❌ Failed to send automated status SMS:", smsErr.message);
                }
            }
        }
        // ------------------------------
        
        res.status(200).json({ message: "Status Updated", appointment });
    } catch (error) {
        console.error("❌ Status error:", error);
        res.status(500).json({ message: "Failed to update status." });
    }
});

// --- DYNAMIC ID ROUTES (Placed LAST) ---

// 8. GET SINGLE APPOINTMENT
router.get('/:id', protect, async (req, res) => {
    try {
        const appointment = await Appointment.findOne({ _id: req.params.id, patientId: req.user.id });
        if (!appointment) return res.status(404).json({ message: "Not found" });
        res.status(200).json(appointment);
    } catch (error) {
        res.status(500).json({ message: "Server error." });
    }
});

// 9. PUT - UPDATE/RESCHEDULE
router.put('/:id', protect, async (req, res) => {
    try {
        const { service, date, time, doctor } = req.body;
        // Populating here so we can send an SMS to the user
        const updated = await Appointment.findOneAndUpdate(
            { _id: req.params.id, patientId: req.user.id },
            { service, date, time, doctor, status: 'pending' }, // Rescheduling resets status to pending!
            { new: true }
        ).populate('patientId', 'firstName lastName fullName phone');

        // 🌟 WOW FACTOR: Instant SMS upon Rescheduling
        if (updated && updated.patientId && updated.patientId.phone) {
            const firstName = updated.patientId.firstName || updated.patientId.fullName.split(' ')[0];
            const msg = `Regional Opticians: Hello ${firstName}, your appointment has been rescheduled to ${date} at ${time}. It is currently Pending Approval.`;
            await sendSMS(updated.patientId.phone, msg).catch(err => console.error("Reschedule SMS failed:", err.message));
        }

        res.status(200).json({ message: "Rescheduled!", appointment: updated });
    } catch (error) {
        res.status(500).json({ message: "Failed to update." });
    }
});

// 10. PATCH - CANCEL (Patient Side)
router.patch('/:id/cancel', protect, async (req, res) => {
    try {
        const appointment = await Appointment.findOneAndUpdate(
            { _id: req.params.id, patientId: req.user.id },
            { status: 'cancelled' },
            { new: true }
        ).populate('patientId', 'firstName lastName fullName phone');

        // 🌟 WOW FACTOR: Instant SMS upon Patient Cancellation
        if (appointment && appointment.patientId && appointment.patientId.phone) {
            const firstName = appointment.patientId.firstName || appointment.patientId.fullName.split(' ')[0];
            const msg = `Regional Opticians: Hello ${firstName}, you have successfully cancelled your appointment for ${appointment.date}.`;
            await sendSMS(appointment.patientId.phone, msg).catch(err => console.error("Patient Cancel SMS failed:", err.message));
        }

        res.status(200).json({ message: "Cancelled successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error." });
    }
});

module.exports = router;