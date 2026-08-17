const Record = require('../models/Record');

// Make sure it says "exports.createRecord" exactly like this:
exports.createRecord = async (req, res) => {
    try {
        const { patientId, leftEyeVision, rightEyeVision, opticianNotes } = req.body;

        const newRecord = new Record({
            patientId,
            leftEyeVision,
            rightEyeVision,
            opticianNotes
        });

        await newRecord.save();
        res.status(201).json({ message: "Eye exam record saved successfully!", record: newRecord });
    } catch (error) {
        res.status(500).json({ message: "Error saving record", error: error.message });
    }
};