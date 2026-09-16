const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const Database = require('better-sqlite3')
const path = require('path')

const app = express()
const db = new Database(path.join(__dirname, 'estate.db'))

app.use(cors())
app.use(express.json())

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

app.post('/api/signup', async (req, res) => {
  const { name, email, phone, password } = req.body

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: 'All fields are required.' })
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: 'Password must contain at least 8 characters.',
    })
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10)

    const insertUser = db.prepare(`
      INSERT INTO users (name, email, phone, password)
      VALUES (?, ?, ?, ?)
    `)

    insertUser.run(name, email, phone, hashedPassword)

    res.status(201).json({ message: 'Account created successfully.' })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ message: 'Email already exists.' })
    }

    res.status(500).json({ message: 'Server error.' })
  }
})

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' })
  }

  try {
    const user = db.prepare(`
      SELECT id, name, email, phone, password
      FROM users
      WHERE email = ?
    `).get(email)

    const passwordMatches = user && await bcrypt.compare(password, user.password)

    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    res.json({
      message: `Welcome back, ${user.name}.`,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone },
    })
  } catch (error) {
    res.status(500).json({ message: 'Server error.' })
  }
})

app.post('/api/reset-password', async (req, res) => {
  const { email, phone, password } = req.body

  if (!email || !phone || !password) {
    return res.status(400).json({ message: 'Email, phone number, and new password are required.' })
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must contain at least 8 characters.' })
  }

  try {
    const user = db.prepare(`
      SELECT id FROM users WHERE email = ? AND phone = ?
    `).get(email, phone)

    if (!user) {
      return res.status(404).json({ message: 'No account found with that email and phone number.' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id)

    res.json({ message: 'Password updated successfully. You can now log in.' })
  } catch (error) {
    res.status(500).json({ message: 'Server error.' })
  }
})

const faqReplies = [
  {
    keywords: ['hello', 'hi', 'hey', 'greetings', 'good morning', 'goodmorning', 'goodmornig'],
    reply: 'Good morning! Welcome to Estate Desk. I can help you explore properties, understand pricing, arrange a site visit, or learn about the booking process.',
  },
  {
    keywords: ['available', 'property', 'properties', 'listing', 'home'],
    reply: 'We currently offer apartments, villas, and plotted developments. Browse the Projects section for available homes, prices, amenities, and locations, then contact us for the latest inventory.',
  },
  {
    keywords: ['visit', 'tour', 'site'],
    reply: 'You can schedule a site visit through the Contact section. Share your preferred date, project, and phone number, and our property advisor will confirm the appointment.',
  },
  {
    keywords: ['price', 'pricing', 'cost', 'budget', 'emi', 'finance', 'loan'],
    reply: 'Property prices and payment plans vary by project and unit. Our team can explain the current price, booking amount, EMI options, and available bank financing for your preferred property.',
  },
  {
    keywords: ['safety', 'security', 'cctv', 'guard', 'gated', 'fire', 'emergency'],
    reply: 'Our projects are planned with customer safety in mind, including controlled access, security personnel, CCTV monitoring, well-lit common areas, and fire-safety provisions. Please contact our advisor for the exact safety facilities at a specific project.',
  },
  {
    keywords: ['document', 'documents', 'book', 'booking', 'reserve'],
    reply: 'For booking, keep a government ID, PAN card, address proof, recent photographs, and the booking amount ready. Requirements can vary, so our advisor will confirm the exact list.',
  },
  {
    keywords: ['contact', 'agent', 'call', 'phone', 'support'],
    reply: 'Use the Contact section to send your name, email, phone number, and query. A member of our team will get back to you with property-specific help.',
  },
]

function getFaqReply(message) {
  const normalizedMessage = message.toLowerCase()
  const matchingFaq = faqReplies.find(({ keywords }) =>
    keywords.some((keyword) => normalizedMessage.includes(keyword)),
  )

  return matchingFaq?.reply || 'I can help with available properties, pricing and financing, site visits, booking documents, and contacting an advisor. What would you like to know?'
}

app.post('/api/chat', async (req, res) => {
  const { message } = req.body

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'Please enter a question.' })
  }

  const trimmedMessage = message.trim().slice(0, 1000)

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ reply: getFaqReply(trimmedMessage) })
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You are Estate Desk, a concise and helpful real-estate customer assistant. Answer only questions related to property discovery, pricing, site visits, booking, financing, and customer support. Never invent exact prices or availability. If details are missing, direct the customer to the Contact section.',
          },
          { role: 'user', content: trimmedMessage },
        ],
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.4,
      }),
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'AI provider request failed.')
    }

    return res.json({ reply: data.choices?.[0]?.message?.content || getFaqReply(trimmedMessage) })
  } catch (error) {
    console.error('Chat provider error:', error.message)
    return res.json({ reply: getFaqReply(trimmedMessage) })
  }
})

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found.' })
})

const port = process.env.PORT || 5000

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`)
})