# SIETK AI Chatbot 🎓🤖

An intelligent, real-time AI assistant for **Siddharth Institute of Engineering and Technology (SIETK), Puttur**. Designed to help students, parents, and faculty with accurate information about the institution.

## ✨ Features

- **Local Knowledge Base**: Pre-loaded with comprehensive SIETK data including departments, courses, fees, and placements.
- **Real-Time Web Search**: Integrated with Exa AI to fetch the latest notifications, results, and updates directly from the web.
- **Smart Responses**: Powered by Google Gemini 1.5 Flash for human-like, engaging, and accurate conversations.
- **Modern UI**: A sleek, responsive chat interface built with Tailwind CSS and Shadcn UI.
- **Multi-Source Logic**: Intelligently combines internal data with live search results for the most complete answers.

## 🛠️ Tech Stack

- **Framework**: Next.js 15+ (App Router)
- **AI Models**: Google Gemini 1.5 Flash (Primary), Llama 3 via Groq (Fallback)
- **Search Engine**: Exa AI (formerly Metaphor)
- **Styling**: Tailwind CSS & Lucide Icons
- **Components**: Shadcn UI (Radix UI)
- **Language**: TypeScript

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Ali-5427/SIETK-AI-ChatBot.git
   cd SIETK-AI-ChatBot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up Environment Variables:
   Create a `.env.local` file in the root directory and add your keys:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   EXA_API_KEY=your_exa_api_key_here
   GROQ_API_KEY=your_groq_api_key_here (optional fallback)
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 🌐 Deployment

The easiest way to deploy this app is with the [Vercel Platform](https://vercel.com/new).

1. Push your code to GitHub.
2. Import the project into Vercel.
3. Add your environment variables in the Vercel dashboard.
4. Deploy!

## 📞 Contact & Support

- **College Website**: [https://sietk.org](https://sietk.org)
- **Phone**: 08577-264999
- **Address**: Siddharth Nagar, Narayanavanam Road, Puttur - 517583, Andhra Pradesh

---
*Built for the students of SIETK.*
