const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const Payment = require('../models/Payment'); 
const User = require('../models/User'); 
const Appointment = require('../models/Appointment'); // Added to verify appointment ownership

const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
const shortcode = process.env.MPESA_SHORTCODE;
const passkey = process.env.MPESA_PASSKEY;

// Temporary memory cache now stores status, services, AND appointment IDs
const paymentStatuses = {}; 

// --- SECURITY MIDDLEWARE ---
const protect = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: "Not authorized!" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: "Invalid token!" });
    }
};

// 1. Generate Token Middleware
const generateToken = async (req, res, next) => {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    try {
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            { headers: { Authorization: `Basic ${auth}` } }
        );
        req.mpesaToken = response.data.access_token;
        next();
    } catch (error) {
        console.error("Token Error:", error.message);
        res.status(400).json({ message: "Failed to generate token" });
    }
};

// 2. Trigger STK Push
router.post('/stkpush', generateToken, async (req, res) => {
    const { phone, amount, services, appointmentIds, accountReference } = req.body; 
    const formattedPhone = phone.replace('+', ''); 

    const date = new Date();
    const timestamp = date.getFullYear() + ("0" + (date.getMonth() + 1)).slice(-2) + ("0" + date.getDate()).slice(-2) + ("0" + date.getHours()).slice(-2) + ("0" + date.getMinutes()).slice(-2) + ("0" + date.getSeconds()).slice(-2);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    const callbackUrl = `${process.env.NGROK_URL}/api/mpesa/callback`;

    try {
        const response = await axios.post(
            'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            {
                BusinessShortCode: shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerPayBillOnline",
                Amount: amount,
                PartyA: formattedPhone,
                PartyB: shortcode,
                PhoneNumber: formattedPhone,
                CallBackURL: callbackUrl, 
                AccountReference: accountReference || "Regional Opticians",
                TransactionDesc: "Medical Bill Payment"
            },
            { headers: { Authorization: `Bearer ${req.mpesaToken}` } }
        );

        const merchantReqId = response.data.MerchantRequestID;
        
        // Store the specific services AND appointment IDs
        paymentStatuses[merchantReqId] = { 
            status: 'Pending', 
            services: services || "General Eye Care Services",
            appointmentIds: appointmentIds || [] 
        };

        res.status(200).json({ message: "STK Push sent!", merchantRequestId: merchantReqId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to trigger payment." });
    }
});

// 3. Receive Payment Confirmation (The Webhook)
router.post('/callback', async (req, res) => {
    console.log("🔔 M-PESA CALLBACK RECEIVED!");
    
    try {
        const callbackData = req.body.Body.stkCallback;
        const merchantReqId = callbackData.MerchantRequestID;
        
        if (callbackData.ResultCode === 0) {
            console.log("✅ Payment Successful!");
            
            const sessionData = paymentStatuses[merchantReqId];
            const serviceDescription = sessionData ? sessionData.services : "General Eye Care Services";
            const appIds = sessionData ? sessionData.appointmentIds : []; 
            
            const meta = callbackData.CallbackMetadata.Item;
            const amount = meta.find(item => item.Name === 'Amount').Value;
            const receiptNumber = meta.find(item => item.Name === 'MpesaReceiptNumber').Value;
            const phone = meta.find(item => item.Name === 'PhoneNumber').Value;

            console.log(`💰 Amount: Ksh ${amount} | Receipt: ${receiptNumber} | Phone: ${phone}`);

            const newPayment = new Payment({ 
                phone: phone.toString(), 
                amount: amount, 
                receiptNumber: receiptNumber,
                services: serviceDescription,
                appointmentIds: appIds, 
                status: 'Completed' 
            });
            await newPayment.save();

            if(paymentStatuses[merchantReqId]) {
                paymentStatuses[merchantReqId].status = 'Completed';
            }

        } else {
            console.log(`❌ Payment Failed or Cancelled. Reason: ${callbackData.ResultDesc}`);
            if(paymentStatuses[merchantReqId]) {
                paymentStatuses[merchantReqId].status = 'Failed';
            }
        }

        res.status(200).json({ message: "Callback received successfully" });

    } catch (error) {
        console.error("Error processing callback:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// 4. The Polling Route for the Frontend
router.get('/status/:merchantRequestId', (req, res) => {
    const record = paymentStatuses[req.params.merchantRequestId];
    res.status(200).json({ status: record ? record.status : 'Unknown' });
});

// 5. Fetch Receipts safely (🔒 SECURED: By Phone OR Appointment Ownership)
router.get('/my-receipts', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "User not found." });

        // Step 1: Find all appointments belonging to this specific patient
        const userAppointments = await Appointment.find({ patientId: req.user.id });
        const userAppIds = userAppointments.map(app => app._id.toString());

        // Step 2: Normalize their registered phone number
        const normalizedPhone = user.phone.replace('+', '');
        const legacyPhone = user.phone.startsWith('+254') ? user.phone.replace('+254', '0') : user.phone;

        // Step 3: Fetch receipts where the M-Pesa phone matches OR the receipt paid for one of their appointments
        const receipts = await Payment.find({
            $or: [
                { phone: normalizedPhone },
                { phone: legacyPhone },
                { appointmentIds: { $in: userAppIds } }
            ]
        })
        .sort({ date: -1 })
        .limit(15);
            
        res.status(200).json(receipts);
    } catch (error) {
        console.error("Receipt error:", error);
        res.status(500).json({ message: "Server error fetching receipts." });
    }
});

// --- MANUAL PAYMENT CONFIRMATION (FOR CLINICIANS) ---
// 6. POST /api/mpesa/manual-pay
router.post('/manual-pay', protect, async (req, res) => {
    try {
        if (req.user.role === 'patient') {
            return res.status(403).json({ message: "Access Denied: Clinicians only." });
        }

        const { phone, amount, services, appointmentId } = req.body;
        const receiptNumber = "CASH-" + Math.floor(100000 + Math.random() * 900000);

        const newPayment = new Payment({
            phone: phone || "Walk-in",
            amount: amount,
            receiptNumber: receiptNumber,
            services: services || "General Eye Care Services",
            appointmentIds: appointmentId ? [appointmentId] : [], 
            status: 'Completed'
        });

        await newPayment.save();
        console.log(`✅ Manual payment recorded: ${receiptNumber}`);

        res.status(200).json({ 
            message: "Manual payment confirmed successfully", 
            receipt: newPayment 
        });

    } catch (error) {
        console.error("Manual Payment Error:", error);
        res.status(500).json({ message: "Server error during manual payment." });
    }
});

module.exports = router;