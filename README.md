# Regional Opticians - Patient Management System

A comprehensive, full-stack web application designed to digitize patient follow-ups, centralize medical history management, and automate appointment scheduling for specialized optical clinics. 

## 🚀 Features

*   **Role-Based Access Control (RBAC):** Secure, distinct dashboards for Administrators, Clinicians (Optometrists), and Patients.
*   **Automated SMS Reminders:** Integration with the Africa's Talking API and background cron jobs to send automated text message reminders to patients 24 hours prior to their appointments.
*   **Clinical Records Management:** Specialized database architecture to store complex optical prescriptions (Sphere, Cylinder, Axis) and longitudinal visual acuity data.
*   **Appointment Scheduling:** Interactive booking system that prevents double-booking and allows clinicians to manage their daily queues.
*   **Patient Self-Service Portal:** Enables patients to securely log in, view their historical visit summaries, current eyewear prescriptions, and upcoming appointments.

## 🛠️ Technology Stack

**Frontend:**
*   React.js (Single Page Application)
*   HTML5 & JavaScript
*   Tailwind CSS (Responsive UI design)

**Backend:**
*   Node.js & Express.js (RESTful API Gateway)
*   MongoDB & Mongoose (Document-oriented NoSQL database)

**Security & Integrations:**
*   JSON Web Tokens (JWT) for stateless session authentication
*   bcrypt for cryptographic password hashing
*   Africa's Talking SMS API

## 📸 System Previews

*[Optional: Recruiters love visuals. You can drag and drop screenshots of your Admin Dashboard or Patient Portal directly into this GitHub editor later to display them here.]*

## ⚙️ Local Installation & Setup

To run this project locally on your machine:

1. Clone the repository:
   `git clone https://github.com/humphrey-nkunja/regional-opticians.git`
2. Navigate into the project directory:
   `cd regional-opticians`
3. Install dependencies for both the backend and frontend:
   `npm install`
4. Create a `.env` file in the root directory and add your database and API keys:
   `MONGO_URI=your_mongodb_string`
   `JWT_SECRET=your_jwt_secret`
   `AFRICAS_TALKING_API_KEY=your_key`
5. Start the development server:
   `npm run dev`

## 🧠 Architecture Highlights
This system utilizes a decoupled MERN stack architecture. The backend leverages Node.js/Express to handle asynchronous requests and scheduled background tasks (cron jobs), while the MongoDB NoSQL structure allows for flexible storage of nested medical data without rigid schema migrations. Security is handled via a Defense in Depth strategy, utilizing JWTs injected into HTTP headers for protected routing.
