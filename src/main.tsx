import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { uploadsReady } from './lib/uploads'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

uploadsReady()
  .then(() => root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ))
  .catch(() => root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ))
