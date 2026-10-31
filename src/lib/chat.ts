import { componentByPath } from '../app/catalog'
import type { Role } from './store'

export interface ChatView {
  pathname: string
  role?: Role
  name?: string
}

const firstName = (name?: string) => name?.trim().split(/\s+/)[0] || 'there'

const exact = (text: string, words: string[]) => {
  const normalized = text
    .toLowerCase()
    .replace(/[!?.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words.includes(normalized)
}

export function localChatReply(text: string, view: ChatView): string | null {
  const name = firstName(view.name)
  const page = componentByPath(view.pathname).name

  if (exact(text, ['hi', 'hello', 'hey', 'yo', 'hiya', 'howdy', 'hi aegis', 'hello aegis', 'hey aegis', 'namaste', 'good morning', 'good afternoon', 'good evening'])) {
    return `Hi ${name} — good to see you. I'm Aegis Copilot. I can talk through this workspace (alerts, posture, CVEs, the XGBoost signal) or help with general security, code, writing and everyday questions. What are you working on?`
  }

  if (exact(text, ['how are you', 'how are you doing', 'how is it going', "how's it going", 'how do you feel'])) {
    return `Doing well and ready to help, ${name}. Want the current workspace picture, a general question answered, or help thinking through a problem?`
  }

  if (exact(text, ['thanks', 'thank you', 'thx', 'cheers', 'nice', 'great', 'perfect'])) {
    return `Anytime, ${name}. I'm still here if you want to go deeper on ${page.toLowerCase()} or switch to something completely different.`
  }

  if (exact(text, ['bye', 'goodbye', 'see you', 'later', 'good night'])) {
    return `Good luck, ${name}. The workspace is where you left it — come back whenever you need a hand.`
  }

  if (exact(text, ['who are you', 'what are you', 'what is your name', 'introduce yourself'])) {
    return `I'm **Aegis Copilot**, the dedicated assistant page in Aegis Sentinel. I use the live demo context for workspace questions and my own general knowledge for everything else, so you don't have to keep questions inside the dashboard.`
  }

  if (exact(text, ['help', 'what can you do', 'what do you do', 'capabilities', 'how can you help'])) {
    return `I can do two things well:\n\n- **Workspace**: explain alerts, scores, posture, assets, CVEs, anomalies, provenance and the XGBoost signal using the current demo data.\n- **General**: answer security concepts, coding, writing, maths and everyday questions.\n\nTry "what should I patch first?" for the workspace, or "explain EPSS vs CVSS" for a general answer.`
  }

  if (exact(text, ['what is aegis', 'what is aegis sentinel', 'what is this site', 'what is this app'])) {
    return `**Aegis Sentinel** is a threat early-warning command centre demo. It correlates CVEs with your inventory, scores exploitation risk, shows the evidence behind each alert, and adds an AI copilot plus a trained XGBoost model for prioritisation. Asset and traffic data are simulated; NVD, CISA KEV and FIRST EPSS identifiers are real public records.`
  }

  return null
}
