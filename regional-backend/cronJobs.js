// cronJobs.js
const cron = require('node-cron');
const Appointment = require('./models/Appointment');
const User = require('./models/User');
const sendSMS = require('./utils/sms');

/**
 * TEST VERSION: Runs every minute ('* * * * *')
 * For final submission, change to '0 8 * * *' (Every day at 8:00 AM)
 */
cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Cron Job: Checking for tomorrow\'s appointments...');

    try {
        // 1. Get the date for "tomorrow"
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Format as YYYY-MM-DD to match your MongoDB date strings
        const dateString = tomorrow.toISOString().split('T')[0]; 

        // 2. Find appointments matching tomorrow's date
        const upcomingAppointments = await Appointment.find({ 
            date: dateString,
            status: 'scheduled' 
        });

        if (upcomingAppointments.length === 0) {
            console.log(`No appointments found for tomorrow (${dateString}).`);
            return;
        }

        console.log(`Found ${upcomingAppointments.length} appointment(s) for ${dateString}. Sending reminders...`);

        // 3. Loop through and send the SMS
        for (let appt of upcomingAppointments) {
            const patient = await User.findById(appt.patientId);
            
            if (patient && patient.phone) {
                const firstName = patient.fullName.split(' ')[0];
                const msg = `Reminder: Hello ${firstName}, you have an eye exam tomorrow (${appt.date}) at ${appt.time} at Regional Opticians.`;
                
                await sendSMS(patient.phone, msg);
            }
        }
    } catch (error) {
        console.error("✘ Cron Job Error:", error);
    }
});

console.log('✅ Background Reminder Service is active.');