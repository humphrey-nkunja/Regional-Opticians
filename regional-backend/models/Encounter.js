const mongoose = require('mongoose');

const encounterSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    clinicalAssessment: {
        chiefComplaint: String,
        visualAcuity: {
            od: String, // Right eye, e.g., "20/20"
            os: String  // Left eye
        }
    },
    
    opticalPrescription: {
        od: { sph: Number, cyl: Number, axis: Number, add: Number },
        os: { sph: Number, cyl: Number, axis: Number, add: Number },
        pd: Number
    },

    diagnosis: String,
    treatmentNotes: String,
    
    followUpDate: Date 
}, { timestamps: true });

module.exports = mongoose.model('Encounter', encounterSchema);