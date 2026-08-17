const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    receiptNumber: { type: String, required: true, unique: true },
    services: { type: String, default: "General Eye Care Services" },
    appointmentIds: { type: [String], default: [] }, // NEW: Links payment to specific appointments
    date: { type: Date, default: Date.now },
    status: { type: String, default: 'Completed' }
});

module.exports = mongoose.model('Payment', paymentSchema);