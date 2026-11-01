/* Northwind decoy portal — demo sign-in surface + capture feedback. */
(() => {
  const $ = (id) => document.getElementById(id)
  const formView = $('form-view')
  const successView = $('success-view')
  const form = $('login-form')
  const emailInput = $('email')
  const passwordInput = $('password')
  const submit = $('submit')
  const submitLabel = $('submit-label')
  const message = $('message')
  const recorded = $('recorded')
  const originSelect = $('origin')
  const toast = $('toast')
  const reveal = $('reveal')
  const signOut = $('sign-out')

  let busy = false
  let toastTimer = 0
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  let consoleBase = localHost
    ? `${location.protocol}//${location.hostname}:5173`
    : 'https://decoy2.onrender.com'

  const countAttempts = $('count-attempts')
  const countFailed = $('count-failed')
  const countGranted = $('count-granted')
  const captureStrip = $('capture-strip')
  const requestList = $('request-list')
  const requestNote = $('request-log-note')

  const applyConsoleLinks = () => {
    $('console-link').href = `${consoleBase}/app`
    $('console-link-2').href = `${consoleBase}/app/anomalies`
    $('console-link-dataset').href = `${consoleBase}/app/uploads`
  }
  applyConsoleLinks()

  const showToast = (text) => {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3400)
  }

  const renderRequests = (events, total, failed) => {
    if (!requestList) return
    const recent = [...events].slice(-12).reverse()
    if (!recent.length) {
      const empty = document.createElement('li')
      empty.className = 'request-empty'
      empty.textContent = 'No attempts yet. Sign in or run a simulator burst.'
      requestList.replaceChildren(empty)
      requestNote.textContent = 'Every failed request is flagged'
      return
    }
    const fragment = document.createDocumentFragment()
    recent.forEach((event, index) => {
      const item = document.createElement('li')
      item.className = `request-item ${event.success ? 'granted' : 'failed'}`
      const seq = document.createElement('span')
      seq.className = 'request-seq'
      seq.textContent = `#${Number(total) - index}`
      const main = document.createElement('span')
      main.className = 'request-main'
      const who = document.createElement('strong')
      who.textContent = event.email || '(blank)'
      const meta = document.createElement('span')
      const place = [event.city, event.country_name].filter(Boolean).join(', ')
      const time = new Date(event.at).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      meta.textContent = [place || 'Unknown location', event.source_ip, time].filter(Boolean).join(' · ')
      main.append(who, meta)
      const flag = document.createElement('span')
      flag.className = 'request-flag'
      flag.textContent = event.success ? 'Granted' : 'Flagged'
      item.append(seq, main, flag)
      fragment.append(item)
    })
    requestList.replaceChildren(fragment)
    requestNote.textContent = `${failed} failed of ${total} flagged`
  }

  const applySummary = ({ total = 0, failed = 0, granted = 0 } = {}, events) => {
    countAttempts.textContent = Number(total).toLocaleString('en-US')
    countFailed.textContent = Number(failed).toLocaleString('en-US')
    countGranted.textContent = Number(granted).toLocaleString('en-US')
    captureStrip.classList.toggle('has-failures', failed > 0)
    recorded.textContent = failed
      ? `${failed} failed · ${Number(total).toLocaleString('en-US')} attempts`
      : `${Number(total).toLocaleString('en-US')} attempts · no failures`
    if (events) renderRequests(events, total, failed)
  }

  const refreshCapture = async () => {
    try {
      const response = await fetch('/api/events?limit=200', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      applySummary(data, data.events ?? [])
    } catch {
      /* portal is serving the page; a failed count is non-fatal */
    }
  }

  const loadConsoleTarget = async () => {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      if (data.console) {
        consoleBase = String(data.console).replace(/\/+$/, '')
        applyConsoleLinks()
      }
    } catch {
      /* the default localhost target stays in place */
    }
  }

  const showMessage = (kind, title, detail) => {
    message.className = `message ${kind}`
    message.replaceChildren()
    const strong = document.createElement('strong')
    strong.textContent = title
    const span = document.createElement('span')
    span.textContent = detail
    message.append(strong, span)
  }

  const clearMessage = () => {
    message.className = 'message'
    message.replaceChildren()
  }

  const setBusy = (state, label = 'Sign in') => {
    busy = state
    submit.disabled = state
    submitLabel.textContent = state ? 'Checking…' : label
  }

  const describeOrigin = (origin) =>
    `${origin.city}, ${origin.country_name}${origin.is_tor ? ' · Tor exit' : ''}`

  const fact = (label, value) => {
    const row = document.createElement('div')
    row.className = 'fact'
    const span = document.createElement('span')
    span.textContent = label
    const strong = document.createElement('strong')
    strong.textContent = value
    row.append(span, strong)
    return row
  }

  const signedIn = (payload) => {
    const { account, event, origin, total } = payload
    const firstName = account.name.split(' ')[0]
    $('success-title').textContent = `Welcome back, ${firstName}.`
    $('success-sub').textContent = `You are signed in to the Northwind Employee Portal${origin.is_tor ? ' through an anonymising exit node' : ''}.`
    const facts = $('success-facts')
    facts.replaceChildren(
      fact('Account', account.email),
      fact('Department', account.department),
      fact('Source', describeOrigin(origin)),
      fact('Address', event.source_ip),
      fact('Attempt', `#${Number(total).toLocaleString('en-US')} · recorded`),
      fact('Time', new Date(event.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
    )
    formView.hidden = true
    successView.hidden = false
    clearMessage()
    passwordInput.value = ''
    refreshCapture()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) return
    clearMessage()

    const email = emailInput.value.trim()
    const password = passwordInput.value
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    if (!emailOk || !password) {
      showMessage(
        'error',
        !emailOk ? 'Enter a valid work email.' : 'Enter your password.',
        'This attempt was not sent. Nothing was recorded.',
      )
      emailInput.focus()
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, origin: originSelect.value }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'The portal could not process this attempt.')
      }

      applySummary(data)
      if (data.success) {
        signedIn(data)
        showToast(`Granted · request #${data.total} · ${data.failed} failed overall`)
      } else {
        passwordInput.value = ''
        passwordInput.focus()
        showMessage(
          'error',
          'Email or password is incorrect.',
          `Request #${data.total} flagged as failed (${data.failed} failed of ${data.total}) from ${describeOrigin(data.origin)}. Aegis is watching this pattern.`,
        )
        showToast(`Failed request #${data.total} flagged · ${data.failed} total failures`)
      }
    } catch (error) {
      showMessage(
        'error',
        'Could not reach the portal.',
        error instanceof Error ? error.message : 'Check that the decoy server is running on port 4300.',
      )
    } finally {
      setBusy(false)
      refreshCapture()
    }
  })

  document.querySelectorAll('.cred').forEach((button) => {
    button.addEventListener('click', () => {
      emailInput.value = button.dataset.email || ''
      passwordInput.value = button.dataset.password || ''
      clearMessage()
      submit.focus()
      showToast('Demo credentials filled — press Sign in')
    })
  })

  reveal.addEventListener('click', () => {
    const shown = passwordInput.type === 'text'
    passwordInput.type = shown ? 'password' : 'text'
    reveal.textContent = shown ? 'Show' : 'Hide'
    reveal.setAttribute('aria-pressed', String(!shown))
    reveal.setAttribute('aria-label', shown ? 'Show password' : 'Hide password')
    passwordInput.focus()
  })

  signOut.addEventListener('click', () => {
    successView.hidden = true
    formView.hidden = false
    passwordInput.value = ''
    emailInput.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })

  const runSimulation = async (scenario, button) => {
    if (button.disabled) return
    const original = button.textContent
    button.disabled = true
    button.textContent = 'Writing…'
    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Simulation failed.')
      applySummary(data)
      refreshCapture()
      showMessage(
        'ok',
        `${data.added} simulated events written.`,
        `Aegis ingests the capture as a live dataset within 2 seconds · ${data.failed} failed of ${data.total} requests flagged.`,
      )
      showToast(`${data.added} events written · ${data.failed} failures flagged`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Simulation failed.')
    } finally {
      button.disabled = false
      button.textContent = original
    }
  }

  $('sim-ato').addEventListener('click', (event) => runSimulation('ato', event.currentTarget))
  $('sim-spray').addEventListener('click', (event) => runSimulation('spray', event.currentTarget))

  $('reset').addEventListener('click', async (event) => {
    if (!window.confirm('Clear every captured login event? Aegis will drop the live dataset on its next poll.')) return
    const button = event.currentTarget
    button.disabled = true
    try {
      const response = await fetch('/api/reset', { method: 'POST' })
      if (!response.ok) throw new Error('Reset failed.')
      applySummary({ total: 0, failed: 0, granted: 0 }, [])
      clearMessage()
      showToast('Capture cleared · dataset will empty on the next poll')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Reset failed.')
    } finally {
      button.disabled = false
    }
  })

  window.addEventListener('focus', () => {
    refreshCapture()
    loadConsoleTarget()
  })
  loadConsoleTarget()
  refreshCapture()
  setInterval(refreshCapture, 3000)
})()
