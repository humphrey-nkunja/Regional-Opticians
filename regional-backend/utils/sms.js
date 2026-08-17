const AfricasTalking = require('africastalking')({
    apiKey: process.env.AT_API_KEY,
    username: process.env.AT_USERNAME
});

const sms = AfricasTalking.SMS;

/**
 * Sends an SMS via Africa's Talking
 * @param {string} to - The recipient's phone number (already +254...)
 * @param {string} message - The text content
 */
const sendSMS = async (to, message) => {
    try {
        const options = {
            to: [to], // API expects an array
            message: message,
            // FIX: We removed 'from: ...' because custom SenderIDs fail in Sandbox.
            // Leaving it out allows Africa's Talking to use the default sandbox ID.
        };

        const response = await sms.send(options);
        
        // This will now show "Success" instead of "Invalid SenderId"
        console.log("✔ SMS Gateway Response:", JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        console.error("✘ SMS Gateway Error:", error);
        throw error; 
    }
};

module.exports = sendSMS;