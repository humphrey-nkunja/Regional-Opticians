const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // IMPORT BCRYPT HERE
const User = require('../models/User');

// Make sure you have your SMS utility file required here!
const sendSMS = require('../utils/sms'); 

// Helper function to generate a random 4-digit code
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// 1. SIGNUP: Creating an unverified patient and sending OTP
exports.signup = async (req, res) => {
  try {
    const { firstName, lastName, phone, password, nationalId, dateOfBirth, gender } = req.body;

    // Check if phone number already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
        return res.status(400).json({ message: "Phone number already exists in database." });
    }

    const otp = generateOTP();

    // HASH THE PASSWORD BEFORE SAVING
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create the user but flag them as unverified
    const newUser = new User({
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      phone,
      passwordHash: hashedPassword, // SAVE HASHED PASSWORD
      role: 'patient',
      otp: otp,               
      isVerified: false,      
      patientProfile: {
        nationalId,
        dateOfBirth,
        gender
      }
    });

    await newUser.save();

    // Send the SMS via Africa's Talking
    await sendSMS(phone, `Welcome to Regional Opticians! Your verification code is ${otp}`);

    res.status(201).json({ message: "Verification code sent successfully!" });
  } catch (error) {
    res.status(400).json({ message: "Registration failed", error: error.message });
  }
};

// 2. VERIFY OTP: Checking the code and logging them in
exports.verifyOTP = async (req, res) => {
    try {
        const { phone, otp } = req.body;
        const user = await User.findOne({ phone });

        if (!user) return res.status(404).json({ message: "User not found." });
        
        if (user.otp !== otp) {
            return res.status(400).json({ message: "Invalid verification code." });
        }

        // Code matches! Clear the OTP and verify the account
        user.isVerified = true;
        user.otp = null;
        await user.save();

        // Log them in immediately by issuing a token
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({ 
            message: "Verified successfully", 
            token,
            firstName: user.firstName || user.fullName.split(' ')[0], 
            role: user.role 
        });

    } catch (error) {
        res.status(500).json({ message: "Verification failed", error: error.message });
    }
};

// 3. RESEND OTP: Generating a new code and texting it
exports.resendOTP = async (req, res) => {
    try {
        const { phone } = req.body;
        const user = await User.findOne({ phone });

        if (!user) return res.status(404).json({ message: "User not found." });

        // Generate a new code and save it
        const newOtp = generateOTP();
        user.otp = newOtp;
        await user.save();

        // Send the new code
        await sendSMS(phone, `Your new Regional Opticians verification code is ${newOtp}`);

        res.status(200).json({ message: "Verification code resent successfully" });
    } catch (error) {
        res.status(500).json({ message: "Failed to resend code", error: error.message });
    }
};

// 4. LOGIN: Checking a patient's credentials
exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    // Find the user by phone
    const user = await User.findOne({ phone });
    if (!user) {
        return res.status(401).json({ message: "Invalid phone or password" });
    }

    // COMPARE THE PLAIN TEXT PASSWORD WITH THE HASHED PASSWORD IN DB
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    
    // Check if password matches
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid phone or password" });
    }

    // Optional: Block login if they never verified their OTP
    if (user.isVerified === false) {
        return res.status(403).json({ message: "Account not verified. Please complete registration." });
    }

    // Create a digital ID (Token)
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({ 
        message: "Login successful!", 
        token,
        userName: user.firstName || user.fullName.split(' ')[0], 
        role: user.role
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// 5. ADD STAFF: Admin creating a new staff member and texting them a password
exports.addStaff = async (req, res) => {
    try {
        // Extract the staff details from the Admin's frontend form
        const { firstName, lastName, phone, nationalId, role } = req.body;

        // 1. Check if this phone number is already registered
        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ message: "Phone number already exists in the system." });
        }

        // 2. Generate a random 6-character temporary password
        const temporaryPassword = Math.random().toString(36).slice(-6);

        // 3. HASH THE TEMPORARY PASSWORD
        const salt = await bcrypt.genSalt(10);
        const hashedTempPassword = await bcrypt.hash(temporaryPassword, salt);

        // 4. Create the new staff user
        const newStaff = new User({
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`,
            phone,
            passwordHash: hashedTempPassword, // SAVE HASHED TEMP PASSWORD
            role: role,                      
            isVerified: true,                
            patientProfile: {
                nationalId
            }
        });

        await newStaff.save();

        // 5. Send the SMS to the new staff member (Send the plain text temp password so they can log in!)
        const smsMessage = `Hello ${firstName}, you have been added as staff at Regional Opticians. Your temporary password is: ${temporaryPassword}. Please log in and change it.`;
        
        await sendSMS(phone, smsMessage);

        res.status(201).json({ message: "Staff added successfully and SMS sent!" });
    } catch (error) {
        res.status(500).json({ message: "Failed to add staff", error: error.message });
    }
};