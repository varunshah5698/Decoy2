import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useToast } from '../lib/store'
import { Check } from './Icons'

export function ToastHost() {
  const message = useToast((s) => s.message)
  const clear = useToast((s) => s.clear)

  useEffect(() => {
    if (!message) return
    const t = setTimeout(clear, 3600)
    return () => clearTimeout(t)
  }, [message, clear])

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="toast"
          role="status"
          initial={{ opacity: 0, y: 16, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: 10, x: '-50%' }}
        >
          <Check size={15} />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
