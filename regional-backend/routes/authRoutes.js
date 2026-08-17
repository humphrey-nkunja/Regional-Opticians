const express = require('express');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
const User = require('../models/User'); 
const sendSMS = require('../utils/sms'); 

const router = express.Router();

// --- MIDDLEWARE: Verify Token ---
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

// 1. POST /api/auth/signup - Register a new patient (OTP GENERATOR)
router.post('/signup', async (req, res) => {
    try {
        // Now expecting firstName and lastName!
        const { firstName, lastName, phone, password, nationalId, dateOfBirth, gender } = req.body;

        const existingPhone = await User.findOne({ phone: phone });
        if (existingPhone) {
            return res.status(400).json({ message: 'A user with this phone number already exists!' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Generate a 4-digit OTP
        const generatedOtp = Math.floor(1000 + Math.random() * 9000).toString();

        // Stitch the full name together for backward compatibility on dashboards
        const combinedFullName = `${firstName} ${lastName}`;

        const newUser = new User({
            firstName: firstName,
            lastName: lastName,
            fullName: combinedFullName,
            phone: phone,
            passwordHash: hashedPassword,
            role: 'patient', 
            isVerified: false, // LOCK THE ACCOUNT
            otp: generatedOtp, // SAVE THE CODE
            patientProfile: {
                nationalId,
                dob: dateOfBirth, 
                gender: gender     
            }
        });

        await newUser.save();

        // Send the OTP via SMS using just the First Name
        const smsMessage = `Regional Opticians: Hello ${firstName}, your verification code is ${generatedOtp}.`;
        
        await sendSMS(phone, smsMessage).catch(err => console.error("OTP SMS failed:", err));

        // DO NOT send the JWT token. Force them to verify first.
        res.status(201).json({ message: 'OTP sent to your phone.' });

    } catch (error) {
        res.status(500).json({ message: 'Server error during signup.' });
    }
});

// 2. POST /api/auth/verify-otp - Validates OTP and Activates Account (WITH AUTO-LOGIN)
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;

        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ message: "User not found." });

        if (user.isVerified) return res.status(400).json({ message: "Account is already verified." });

        if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP code." });

        // OTP matches! Verify the user and clear the OTP from the database
        user.isVerified = true;
        user.otp = undefined;
        await user.save();

        // --- NEW: Generate Auto-Login Token ---
        const token = jwt.sign(
            { id: user._id, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '1d' }
        );

        res.status(200).json({ 
            message: "Account verified successfully! You can now log in.",
            token: token,
            firstName: user.firstName,
            lastName: user.lastName,
            fullName: user.fullName,
            role: user.role
        });

    } catch (error) {
        console.error("Verify Error:", error);
        res.status(500).json({ message: "Server error during verification." });
    }
});

// ---> NEW: POST /api/auth/resend-otp - Resend the verification code
router.post('/resend-otp', async (req, res) => {
    try {
        const { phone } = req.body;

        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ message: "User not found." });

        if (user.isVerified) return res.status(400).json({ message: "Account is already verified." });

        // Generate a new 4-digit OTP
        const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
        
        // Save the new OTP to the database
        user.otp = newOtp;
        await user.save();

        // Send the new SMS
        const safeFirstName = user.firstName || (user.fullName ? user.fullName.split(' ')[0] : 'Patient');
        const smsMessage = `Regional Opticians: Hello ${safeFirstName}, your new verification code is ${newOtp}.`;
        
        await sendSMS(phone, smsMessage).catch(err => console.error("Resend OTP SMS failed:", err));

        res.status(200).json({ message: "Verification code resent successfully!" });

    } catch (error) {
        console.error("Resend Error:", error);
        res.status(500).json({ message: "Server error during resend." });
    }
});
// -------------------------------------------------------------------

// 3. POST /api/auth/login - Sign in (WITH SMART LEGACY GUARD)
router.post('/login', async (req, res) => {
    try {
        const { phone, password, role } = req.body;

        const user = await User.findOne({ phone });
        if (!user) return res.status(404).json({ message: "User not found!" });

        const userRole = user.role || 'patient'; 
        
        if (userRole !== role) {
            return res.status(403).json({ message: `Access denied. You are not a ${role}.` });
        }

        // --- SMART VERIFICATION GUARD ---
        if (userRole === 'patient' && !user.isVerified) {
            if (!user.otp) {
                // LEGACY USER DETECTED: They have no OTP saved, so they are from the old system.
                console.log(`🔄 Grandfathering in legacy user: ${user.phone}`);
                user.isVerified = true;
                
                // CRITICAL FIX: Give legacy users a firstName and lastName before saving so MongoDB doesn't crash!
                if (!user.firstName && user.fullName) {
                    const nameParts = user.fullName.split(' ');
                    user.firstName = nameParts[0] || 'Patient';
                    user.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User';
                }

                await user.save();
            } else {
                // NEW USER DETECTED: They have an OTP pending, block them.
                return res.status(403).json({ message: "Account not verified. Please verify your phone number via the registration page." });
            }
        }
        // ------------------------------

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials!" });

        const token = jwt.sign(
            { id: user._id, role: userRole }, 
            process.env.JWT_SECRET, 
            { expiresIn: '1d' }
        );

        // Ensure we send back a first name even for verified legacy accounts
        const safeFirstName = user.firstName || (user.fullName ? user.fullName.split(' ')[0] : 'Patient');

        res.status(200).json({ 
            token: token,
            firstName: safeFirstName,
            lastName: user.lastName,
            fullName: user.fullName,
            role: userRole 
        });

    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Server error during login." });
    }
});

// --- ADMIN SPECIFIC ROUTES ---

// 4. GET /api/auth/users - List all users (Admin only)
router.get('/users', protect, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Restricted: Administrator access required." });
        }
        
        const users = await User.find().select('-passwordHash'); 
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: "Error fetching system users." });
    }
});

// 5. PATCH /api/auth/users/:id/role - Update a user's role (Admin only)
router.patch('/users/:id/role', protect, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Unauthorized: Role changes require Admin rights." });
        }

        const { role } = req.body; 
        
        const updatedUser = await User.findByIdAndUpdate(
            req.params.id, 
            { role: role }, 
            { new: true }
        ).select('-passwordHash');
        
        res.json({ message: `User promoted to ${role}`, user: updatedUser });
    } catch (err) {
        res.status(500).json({ message: "Failed to update user role." });
    }
});

// --- CLINICIAN/ADMIN WALK-IN ROUTE ---

// 6. POST /api/auth/register-walkin - Register a walk-in patient and send SMS
router.post('/register-walkin', protect, async (req, res) => {
    try {
        if (req.user.role === 'patient') {
            return res.status(403).json({ message: "Access Denied: Only staff can register walk-ins." });
        }

        const { firstName, lastName, phone, nationalId } = req.body;

        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ message: "A patient with this phone number is already registered." });
        }

        const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPassword, salt);

        const combinedFullName = `${firstName} ${lastName}`;

        // Pre-verify walk-ins since they are physically at the clinic!
        const newUser = new User({
            firstName: firstName,
            lastName: lastName,
            fullName: combinedFullName,
            phone: phone,
            passwordHash: hashedPassword,
            role: 'patient',
            isVerified: true, // Auto-verify walk-ins
            patientProfile: {
                nationalId: nationalId
            }
        });
        
        await newUser.save();
        console.log(`✅ New walk-in patient registered: ${combinedFullName} (${phone})`);

        const message = `Welcome to Regional Opticians, ${firstName}! Your patient account has been successfully created. Your temporary login password is: ${tempPassword}`;
        
        try {
            await sendSMS(phone, message);
            console.log(`📩 Sent temporary password SMS to ${phone}`);
        } catch (smsErr) {
            console.error("❌ SMS Error (Walk-in):", smsErr.message);
        }

        res.status(201).json({ message: "Patient registered successfully", user: { _id: newUser._id, fullName: newUser.fullName, phone: newUser.phone } });
        
    } catch (error) {
        console.error("❌ Walk-in Registration Error:", error);
        res.status(500).json({ message: "Server error during walk-in registration." });
    }
});

// --- PASSWORD RECOVERY ROUTE ---

// 7. POST /api/auth/forgot-password - Generate and SMS a temporary password
router.post('/forgot-password', async (req, res) => {
    try {
        const { phone } = req.body;
        
        const formattedPhone = phone.startsWith('+254') ? phone : `+254${phone.replace(/^0+/, '')}`;

        const user = await User.findOne({ phone: formattedPhone });
        if (!user) {
            return res.status(404).json({ message: "No account found with this phone number." });
        }

        const tempPassword = Math.floor(100000 + Math.random() * 900000).toString();
        
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(tempPassword, salt);
        await user.save();

        // Safely fallback to split fullName if firstName isn't available for older accounts
        const firstName = user.firstName || user.fullName.split(' ')[0];
        const message = `Hello ${firstName}, your Regional Opticians password has been reset. Your new temporary password is: ${tempPassword}. Please log in.`;
        
        try {
            await sendSMS(formattedPhone, message);
            console.log(`📩 Password reset SMS sent to ${formattedPhone}`);
        } catch (smsErr) {
            console.error("❌ SMS Error (Password Reset):", smsErr.message);
            return res.status(500).json({ message: "Failed to send SMS. Please try again." });
        }

        res.status(200).json({ message: "A temporary password has been sent to your phone." });

    } catch (error) {
        console.error("Password Reset Error:", error);
        res.status(500).json({ message: "Server error during password reset." });
    }
});

// --- PATIENT PROFILE ROUTES ---

// 8. GET /api/auth/profile - Get current user profile
router.get('/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-passwordHash -otp');
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
    } catch (err) {
        console.error("Profile Fetch Error:", err);
        res.status(500).json({ message: "Server error fetching profile" });
    }
});

// 9. PUT /api/auth/profile - Update patient profile
router.put('/profile', protect, async (req, res) => {
    try {
        const { firstName, lastName, nationalId, dob, gender } = req.body;
        const user = await User.findById(req.user.id);
        
        if (!user) return res.status(404).json({ message: "User not found" });

        // Update the root user fields
        user.firstName = firstName || user.firstName;
        user.lastName = lastName || user.lastName;
        user.fullName = `${user.firstName} ${user.lastName}`;
        
        // Ensure patientProfile object exists so MongoDB doesn't crash
        if (!user.patientProfile) user.patientProfile = {};
        
        // Update the nested fields
        user.patientProfile.nationalId = nationalId || user.patientProfile.nationalId;
        user.patientProfile.dob = dob || user.patientProfile.dob;
        user.patientProfile.gender = gender || user.patientProfile.gender;

        await user.save();

        res.json({ 
            message: "Profile updated successfully!", 
            user: { firstName: user.firstName, lastName: user.lastName } 
        });
    } catch (err) {
        console.error("Profile Update Error:", err);
        res.status(500).json({ message: "Failed to update profile", error: err.message });
    }
});

module.exports = router;