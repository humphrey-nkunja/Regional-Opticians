const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clinicianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    chiefComplaint: { type: String, required: true },
    visualAcuity: {
        OD: String,
        OS: String
    },
    prescription: {
        OD: { sph: String, cyl: String, axis: String, add: String },
        OS: { sph: String, cyl: String, axis: String, add: String },
        pd: String
    },
    diagnosis: { type: String, required: true },
    treatmentNotes: String
}, { timestamps: true });

module.exports = mongoose.model('Record', recordSchema);