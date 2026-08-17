const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    role: { type: String, enum: ['patient', 'clinician', 'admin'], default: 'patient' },
    
    // --- NEW: Separated Name Fields ---
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    fullName: { type: String, required: true }, // We keep this so existing dashboards don't break!
    
    phone: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    
    // OTP & Verification status
    isVerified: { type: Boolean, default: false },
    otp: { type: String },

    // This section only applies to patients
    patientProfile: {
        nationalId: { type: String },
        dob: { type: Date },
        gender: { type: String, enum: ['male', 'female', 'other', 'Male', 'Female', 'Other'] }
    }
}, { timestamps: true }); 

module.exports = mongoose.model('User', userSchema);