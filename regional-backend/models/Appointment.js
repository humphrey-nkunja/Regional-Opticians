const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Links the appointment to a specific patient
        required: true
    },
    // Links the appointment to a specific staff member
    clinicianId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: false // Kept false so patients can book before a doctor is assigned
    },
    service: { type: String, required: true },
    // Stores how much this specific appointment costs for revenue tracking
    price: { type: Number, default: 0 }, 
    date: { type: String, required: true },
    time: { type: String, required: true },
    doctor: { type: String, default: 'Any available' }, 
    status: { 
        type: String, 
        enum: ['pending', 'scheduled', 'completed', 'cancelled'], // NEW: Added 'pending'
        default: 'pending' // NEW: All new appointments start as pending
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Appointment', appointmentSchema);