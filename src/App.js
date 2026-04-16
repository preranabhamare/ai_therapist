import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { generateGeminiReply, hasGeminiConfig } from './lib/gemini';
import { hasSupabaseConfig, supabase } from './lib/supabase';

const NAV_ITEMS = [
  { id: 'session', label: 'Session', icon: <ChatIcon /> },
  { id: 'mood', label: 'Mood', icon: <PulseIcon /> },
  { id: 'history', label: 'History', icon: <BookIcon /> },
  { id: 'exercises', label: 'Exercises', icon: <HeartIcon /> },
];

const MOODS = [
  { badge: 'Sad', label: 'Very Low', value: 1 },
  { badge: 'Low', label: 'Low', value: 2 },
  { badge: 'Okay', label: 'Neutral', value: 3 },
  { badge: 'Good', label: 'Good', value: 4 },
  { badge: 'Great', label: 'Great', value: 5 },
];

const TAGS = ['Hopeful', 'Anxious', 'Grateful', 'Tired', 'Stressed', 'Calm'];
const EXERCISES = [
  { id: 'box', icon: 'Air', title: 'Box Breathing', subtitle: 'Calm your nervous system', accent: 'green' },
  { id: 'grounding', icon: 'Anchor', title: '5-4-3-2-1 Grounding', subtitle: 'Return to the present', accent: 'sand' },
  { id: 'thought', icon: 'CBT', title: 'Thought Record', subtitle: 'Challenge negative thinking', accent: 'clay' },
];
const BREATH_PHASES = [
  { label: 'Inhale', duration: 4, instruction: 'Breathe in slowly through your nose' },
  { label: 'Hold', duration: 4, instruction: 'Hold your breath gently' },
  { label: 'Exhale', duration: 4, instruction: 'Breathe out slowly through your mouth' },
  { label: 'Hold', duration: 4, instruction: 'Pause before the next breath' },
];
const INITIAL_ASSISTANT_MESSAGE =
  'Hello, I am Ai Therapist. This is a calm, judgment-free space. How are you feeling today?';
const DEMO_ENTRIES = [2, 3, 2, 4, 3, 3, 4, 3, 5, 4, 3, 4, 4, 4].map((value, index, values) => ({
  id: `demo-${index}`,
  mood_value: value,
  tags: [],
  created_at: new Date(Date.now() - (values.length - index - 1) * 86400000).toISOString(),
}));

function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authStatus, setAuthStatus] = useState(
    hasSupabaseConfig ? 'Sign in to continue.' : 'Supabase env vars are missing. Add them before using auth.'
  );
  const [isAuthLoading, setIsAuthLoading] = useState(hasSupabaseConfig);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [activePage, setActivePage] = useState('session');
  const [trackerMood, setTrackerMood] = useState(4);
  const [selectedTags, setSelectedTags] = useState(['Hopeful', 'Grateful']);
  const [messages, setMessages] = useState([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
  const [draft, setDraft] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatStatus, setChatStatus] = useState(
    hasGeminiConfig
      ? 'Your conversations will be stored in Supabase.'
      : 'Gemini API key is missing. Add REACT_APP_GEMINI_API_KEY to enable replies.'
  );
  const [sessionList, setSessionList] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [openSessions, setOpenSessions] = useState({});
  const [isBreathingOpen, setIsBreathingOpen] = useState(false);
  const [breathRunning, setBreathRunning] = useState(false);
  const [breathPhase, setBreathPhase] = useState(0);
  const [breathTick, setBreathTick] = useState(0);
  const [breathCycle, setBreathCycle] = useState(1);
  const [breathingFinished, setBreathingFinished] = useState(false);
  const [tagMap, setTagMap] = useState({});
  const [moodEntries, setMoodEntries] = useState(DEMO_ENTRIES);
  const [moodStatus, setMoodStatus] = useState('Sign in to load your mood history.');
  const [isMoodSaving, setIsMoodSaving] = useState(false);
  const messagesRef = useRef(null);

  const userId = session?.user?.id ?? null;
  const profileLabel = session?.user?.user_metadata?.display_name || session?.user?.email || 'Signed in user';

  const recentMoodEntries = useMemo(() => {
    const sorted = [...moodEntries].sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    );
    return sorted.slice(-14);
  }, [moodEntries]);

  const moodAverage = useMemo(() => {
    if (!moodEntries.length) {
      return 0;
    }
    return moodEntries.reduce((sum, entry) => sum + Number(entry.mood_value || 0), 0) / moodEntries.length;
  }, [moodEntries]);

  const averageMood = useMemo(() => {
    const rounded = Math.max(1, Math.min(5, Math.round(moodAverage || trackerMood)));
    return MOODS.find((mood) => mood.value === rounded) ?? MOODS[0];
  }, [moodAverage, trackerMood]);

  useEffect(() => {
    if (!messagesRef.current) {
      return;
    }
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages, isTyping]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setIsAuthLoading(false);
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return;
      }
      if (error) {
        setAuthStatus(error.message);
        setIsAuthLoading(false);
        return;
      }
      setSession(data.session ?? null);
      setIsAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null);
      if (nextSession) {
        setAuthStatus('Signed in.');
        if (event === 'SIGNED_IN') {
          setActivePage('session');
          setActiveSessionId(null);
          setMessages([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
          setDraft('');
          setChatStatus(
            hasGeminiConfig
              ? 'New chat ready. Your next message will start a stored Gemini session.'
              : 'Gemini API key is missing. Add REACT_APP_GEMINI_API_KEY to enable replies.'
          );
        }
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!breathRunning || breathingFinished) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setBreathTick((currentTick) => {
        const phase = BREATH_PHASES[breathPhase];
        if (currentTick + 1 < phase.duration) {
          return currentTick + 1;
        }
        setBreathPhase((currentPhase) => {
          if (currentPhase + 1 < BREATH_PHASES.length) {
            return currentPhase + 1;
          }
          setBreathCycle((currentCycle) => {
            if (currentCycle >= 4) {
              window.clearInterval(timer);
              setBreathRunning(false);
              setBreathingFinished(true);
              return currentCycle;
            }
            return currentCycle + 1;
          });
          return 0;
        });
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [breathRunning, breathPhase, breathingFinished]);

  useEffect(() => {
    let ignore = false;
    async function loadMoodData() {
      if (!supabase || !userId) {
        setMoodEntries(DEMO_ENTRIES);
        setMoodStatus(hasSupabaseConfig ? 'Sign in to load your mood history.' : 'Using local demo mood data.');
        return;
      }
      setMoodStatus('Loading your mood history...');
      const [tagsResult, entriesResult] = await Promise.all([
        supabase.from('mood_tags').select('id, label'),
        supabase
          .from('mood_entries')
          .select(`
            id,
            mood_value,
            created_at,
            mood_entry_tags (
              mood_tags (
                label
              )
            )
          `)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (ignore) {
        return;
      }
      if (tagsResult.error) {
        setMoodStatus(`Failed to load mood tags: ${tagsResult.error.message}`);
        return;
      }
      const nextTagMap = {};
      (tagsResult.data ?? []).forEach((tag) => {
        nextTagMap[tag.label] = tag.id;
      });
      setTagMap(nextTagMap);
      if (entriesResult.error) {
        setMoodEntries([]);
        setMoodStatus(`Failed to load mood entries: ${entriesResult.error.message}`);
        return;
      }
      const normalized = (entriesResult.data ?? []).map((entry) => ({
        id: entry.id,
        mood_value: entry.mood_value,
        created_at: entry.created_at,
        tags: (entry.mood_entry_tags ?? []).map((item) => item.mood_tags?.label).filter(Boolean),
      }));
      setMoodEntries(normalized);
      if (normalized.length > 0) {
        setTrackerMood(normalized[0].mood_value);
        setSelectedTags(normalized[0].tags);
        setMoodStatus('Mood history loaded from Supabase.');
      } else {
        setSelectedTags([]);
        setMoodStatus('No mood entries yet. Log your first check-in.');
      }
    }
    loadMoodData();
    return () => {
      ignore = true;
    };
  }, [userId]);

  useEffect(() => {
    let ignore = false;
    async function loadChatSessions() {
      if (!supabase || !userId) {
        setSessionList([]);
        setActiveSessionId(null);
        setMessages([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
        setOpenSessions({});
        setChatStatus(
          hasGeminiConfig
            ? 'Sign in to start a Gemini-powered chat.'
            : 'Gemini API key is missing. Add REACT_APP_GEMINI_API_KEY to enable replies.'
        );
        return;
      }
      setIsSessionLoading(true);
      setChatStatus('Loading your conversation history...');
      const { data, error } = await supabase
        .from('therapy_sessions')
        .select(`
          id,
          title,
          summary,
          started_at,
          session_status,
          initial_mood_value,
          session_messages (
            id,
            sender_role,
            content,
            sequence_no,
            created_at
          )
        `)
        .order('started_at', { ascending: false })
        .order('sequence_no', { foreignTable: 'session_messages', ascending: true });
      if (ignore) {
        return;
      }
      if (error) {
        setSessionList([]);
        setMessages([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
        setChatStatus(`Failed to load chat history: ${error.message}`);
        setIsSessionLoading(false);
        return;
      }
      const normalizedSessions = (data ?? []).map((item) => {
        const sessionMessages = (item.session_messages ?? []).sort((left, right) => left.sequence_no - right.sequence_no);
        return {
          id: item.id,
          title: item.title,
          summary: item.summary,
          started_at: item.started_at,
          session_status: item.session_status,
          initial_mood_value: item.initial_mood_value,
          messages: sessionMessages.map((message) => ({
            id: message.id,
            role: message.sender_role === 'assistant' ? 'assistant' : message.sender_role,
            text: message.content,
            created_at: message.created_at,
            sequence_no: message.sequence_no,
          })),
        };
      });
      setSessionList(normalizedSessions);
      setOpenSessions(
        normalizedSessions.reduce((acc, item, index) => ({ ...acc, [item.id]: index === 0 }), {})
      );
      setActiveSessionId(null);
      setMessages([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
      setChatStatus(
        normalizedSessions.length > 0
          ? 'New chat ready. Previous conversations are available in History.'
          : 'No sessions yet. Start a new conversation.'
      );
      setIsSessionLoading(false);
    }
    loadChatSessions();
    return () => {
      ignore = true;
    };
  }, [userId]);

  const handleAuthChange = (field, value) => {
    setAuthForm((current) => ({ ...current, [field]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (!supabase || !hasSupabaseConfig) {
      setAuthStatus('Supabase env vars are missing. Add them before using auth.');
      return;
    }
    setIsAuthSubmitting(true);
    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email: authForm.email,
        password: authForm.password,
      });
      setIsAuthSubmitting(false);
      setAuthStatus(error ? error.message : 'Signed in.');
      return;
    }
    const { error } = await supabase.auth.signUp({
      email: authForm.email,
      password: authForm.password,
      options: { data: { display_name: authForm.name } },
    });
    setIsAuthSubmitting(false);
    if (error) {
      setAuthStatus(error.message);
      return;
    }
    setAuthStatus('Account created. Check your email if confirmation is enabled, then sign in.');
    setAuthMode('login');
    setAuthForm((current) => ({ ...current, password: '' }));
  };

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }
    await supabase.auth.signOut();
    setMoodEntries(DEMO_ENTRIES);
    setMoodStatus('Signed out. Sign in to load your mood history.');
    setSessionList([]);
    setActiveSessionId(null);
    setMessages([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
  };

  const toggleTag = (tag) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag]
    );
  };

  const toggleSession = (sessionId) => {
    setOpenSessions((current) => ({ ...current, [sessionId]: !current[sessionId] }));
  };

  const openBreathing = () => {
    setIsBreathingOpen(true);
    setBreathRunning(false);
    setBreathPhase(0);
    setBreathTick(0);
    setBreathCycle(1);
    setBreathingFinished(false);
  };

  const closeBreathing = () => {
    setIsBreathingOpen(false);
    setBreathRunning(false);
  };

  const toggleBreathing = () => {
    if (breathingFinished) {
      closeBreathing();
      return;
    }
    setBreathRunning((current) => !current);
  };

  const loadSessionMessages = (sessionId) => {
    const selected = sessionList.find((item) => item.id === sessionId);
    setActiveSessionId(sessionId);
    setActivePage('session');
    setMessages(selected?.messages?.length ? selected.messages : [{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
    setChatStatus('Loaded stored conversation.');
  };

  const createNewSession = async () => {
    if (!supabase || !userId) {
      setChatStatus('Sign in first to start a session.');
      return null;
    }
    const title = `Session ${new Date().toLocaleDateString()}`;
    const { data, error } = await supabase
      .from('therapy_sessions')
        .insert({
        user_id: userId,
        title,
        initial_mood_value: null,
      })
      .select('id, title, summary, started_at, session_status, initial_mood_value')
      .single();
    if (error) {
      setChatStatus(`Failed to create session: ${error.message}`);
      return null;
    }
    const nextSession = { ...data, messages: [] };
    setSessionList((current) => [nextSession, ...current]);
    setOpenSessions((current) => ({ [data.id]: true, ...current }));
    setActiveSessionId(data.id);
    setMessages([{ role: 'assistant', text: INITIAL_ASSISTANT_MESSAGE }]);
    setChatStatus('New session created. Your next message will be stored.');
    return data.id;
  };

  const updateSessionInState = (sessionId, nextMessages, fallbackTitle) => {
    setSessionList((current) => {
      const existing = current.find((item) => item.id === sessionId);
      const updated = {
        ...(existing || {
          id: sessionId,
          title: fallbackTitle,
          summary: null,
          started_at: new Date().toISOString(),
          session_status: 'active',
          initial_mood_value: null,
        }),
        title: existing?.title || fallbackTitle,
        messages: nextMessages,
      };
      const withoutCurrent = current.filter((item) => item.id !== sessionId);
      return [updated, ...withoutCurrent];
    });
  };

  const sendMessage = async () => {
    const value = draft.trim();
    if (!value || isTyping || !supabase || !userId) {
      return;
    }
    if (!hasGeminiConfig) {
      setChatStatus('Gemini API key is missing. Add REACT_APP_GEMINI_API_KEY to enable replies.');
      return;
    }
    setIsTyping(true);
    setChatStatus('Saving your message...');
    const currentSessionId = activeSessionId || (await createNewSession());
    if (!currentSessionId) {
      setIsTyping(false);
      return;
    }
    const baseMessages =
      activeSessionId === currentSessionId
        ? messages.filter((message) => message.role === 'user' || message.role === 'assistant')
        : [];
    const userMessage = {
      role: 'user',
      text: value,
      sequence_no: baseMessages.length + 1,
      created_at: new Date().toISOString(),
    };
    const nextMessages = [...baseMessages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    const sessionTitle = value.slice(0, 60) || `Session ${new Date().toLocaleDateString()}`;
    const { error: titleError } = await supabase
      .from('therapy_sessions')
      .update({ title: sessionTitle })
      .eq('id', currentSessionId)
      .eq('user_id', userId);
    if (titleError) {
      setChatStatus(`Session updated, but title save failed: ${titleError.message}`);
    }
    const { error: userMessageError } = await supabase.from('session_messages').insert({
      session_id: currentSessionId,
      user_id: userId,
      sender_role: 'user',
      content: value,
      sequence_no: userMessage.sequence_no,
      metadata: { provider: 'gemini' },
    });
    if (userMessageError) {
      setIsTyping(false);
      setChatStatus(`Failed to save your message: ${userMessageError.message}`);
      return;
    }
    updateSessionInState(currentSessionId, nextMessages, sessionTitle);
    setChatStatus('Generating Gemini reply...');
    try {
      const reply = await generateGeminiReply(nextMessages);
      const assistantMessage = {
        role: 'assistant',
        text: reply.text,
        sequence_no: nextMessages.length + 1,
        created_at: new Date().toISOString(),
      };
      const allMessages = [...nextMessages, assistantMessage];
      setMessages(allMessages);
      const { error: assistantMessageError } = await supabase.from('session_messages').insert({
        session_id: currentSessionId,
        user_id: userId,
        sender_role: 'assistant',
        content: reply.text,
        sequence_no: assistantMessage.sequence_no,
        metadata: { provider: 'gemini', model: reply.model },
      });
      if (assistantMessageError) {
        setChatStatus(`Gemini replied, but save failed: ${assistantMessageError.message}`);
        setIsTyping(false);
        return;
      }
      updateSessionInState(currentSessionId, allMessages, sessionTitle);
      setChatStatus(`Reply generated by ${reply.model} and saved to Supabase.`);
    } catch (error) {
      setChatStatus(error.message || 'Gemini request failed.');
    } finally {
      setIsTyping(false);
    }
  };

  const logMood = async () => {
    if (!supabase || !userId) {
      setMoodStatus('Sign in first to save mood entries to Supabase.');
      return;
    }
    setIsMoodSaving(true);
    const { data: moodEntry, error: moodError } = await supabase
      .from('mood_entries')
      .insert({
        user_id: userId,
        mood_value: trackerMood,
        source: 'manual',
      })
      .select('id, mood_value, created_at')
      .single();
    if (moodError) {
      setIsMoodSaving(false);
      setMoodStatus(`Save failed: ${moodError.message}`);
      return;
    }
    const selectedTagIds = selectedTags.map((label) => tagMap[label]).filter(Boolean);
    if (selectedTagIds.length) {
      const { error: tagError } = await supabase.from('mood_entry_tags').insert(
        selectedTagIds.map((tagId) => ({
          mood_entry_id: moodEntry.id,
          tag_id: tagId,
        }))
      );
      if (tagError) {
        setIsMoodSaving(false);
        setMoodStatus(`Mood saved, but tags failed: ${tagError.message}`);
        return;
      }
    }
    setMoodEntries((current) => [{ ...moodEntry, tags: selectedTags }, ...current]);
    setIsMoodSaving(false);
    setMoodStatus('Mood entry saved to Supabase.');
  };

  const phase = BREATH_PHASES[breathPhase];
  const countdown = breathingFinished ? 'Done' : phase.duration - breathTick;
  const progress = breathingFinished ? 1 : (breathTick + (breathRunning ? 1 : 0)) / phase.duration;
  const ringOffset = 439.8 * (1 - progress);

  if (isAuthLoading) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card-loading">
          <div className="auth-brand">Ai Therapist</div>
          <p className="auth-status">Checking your session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-layout">
          <section className="auth-hero">
            <div className="auth-badge">AI-supported mental wellness</div>
            <h1 className="auth-title">Continue with your calm space.</h1>
            <p className="auth-copy">
              Sign in to access your therapy sessions, mood history, and guided exercises backed by
              Supabase authentication.
            </p>
            <div className="auth-points">
              <div>Private account with Supabase Auth</div>
              <div>Mood history tied to your profile</div>
              <div>Stored therapy sessions and chat history</div>
            </div>
          </section>

          <section className="auth-card">
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => setAuthMode('signup')}
              >
                Sign Up
              </button>
            </div>

            <h2 className="auth-form-title">
              {authMode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="auth-form-copy">
              {authMode === 'login'
                ? 'Use your email and password to access the app.'
                : 'Create a Supabase-backed account for this application.'}
            </p>

            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === 'signup' && (
                <label className="auth-field">
                  <span>Name</span>
                  <input
                    value={authForm.name}
                    onChange={(event) => handleAuthChange('name', event.target.value)}
                    placeholder="Prerana"
                    disabled={!hasSupabaseConfig || isAuthSubmitting}
                  />
                </label>
              )}

              <label className="auth-field">
                <span>Email</span>
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => handleAuthChange('email', event.target.value)}
                  placeholder="name@example.com"
                  disabled={!hasSupabaseConfig || isAuthSubmitting}
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => handleAuthChange('password', event.target.value)}
                  placeholder="At least 6 characters"
                  disabled={!hasSupabaseConfig || isAuthSubmitting}
                />
              </label>

              <button className="auth-submit" type="submit" disabled={!hasSupabaseConfig || isAuthSubmitting}>
                {isAuthSubmitting ? 'Working...' : authMode === 'login' ? 'Login' : 'Create account'}
              </button>
            </form>

            <p className="auth-status">{authStatus}</p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="therapy-app">
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon" aria-hidden="true">
              AT
            </div>
            <div>
              <div className="logo-name">Ai Therapist</div>
              <div className="logo-sub">{profileLabel}</div>
            </div>
          </div>

          <nav className="nav">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                onClick={() => setActivePage(item.id)}
                type="button"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <div className="sidebar-note">Not a replacement for professional mental health care.</div>
            <button className="sidebar-signout" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </aside>

        <main className="main">
          {activePage === 'session' && (
            <section className="page active-page">
              <header className="page-header">
                <div>
                  <h1 className="page-title">Therapy Session</h1>
                  <p className="page-sub">
                    {activeSessionId ? 'Gemini chat stored in Supabase.' : 'Start a new Gemini-backed conversation.'}
                  </p>
                </div>
                <div className="header-actions">
                  <button className="btn-icon" type="button" aria-label="Toggle voice">
                    VO
                  </button>
                  <button className="btn-sm" type="button" onClick={createNewSession}>
                    + New
                  </button>
                </div>
              </header>

              <div className="messages" ref={messagesRef}>
                <div className="status-note status-note-chat">{chatStatus}</div>

                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${message.sequence_no || index}`}
                    className={`msg-row ${message.role === 'user' ? 'user' : 'ai'}`}
                  >
                    {message.role !== 'user' && <div className="ai-avatar">AT</div>}
                    <div className={`bubble ${message.role === 'user' ? 'user' : 'ai'}`}>{message.text}</div>
                  </div>
                ))}

                {isTyping && (
                  <div className="msg-row ai">
                    <div className="ai-avatar">AT</div>
                    <div className="typing">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  </div>
                )}
              </div>

              <div className="input-area">
                <div className="input-row">
                  <input
                    className="input-box"
                    placeholder="Share what's on your mind..."
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={isSessionLoading || isTyping}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        sendMessage();
                      }
                    }}
                  />
                  <button className="mic-btn" type="button">
                    Mic
                  </button>
                  <button className="send-btn" type="button" onClick={sendMessage} disabled={isTyping || isSessionLoading}>
                    Go
                  </button>
                </div>
                <div className="hint">Press Enter to send | This is not a substitute for professional care</div>
              </div>
            </section>
          )}

          {activePage === 'mood' && (
            <section className="page active-page">
              <header className="page-header">
                <div>
                  <h1 className="page-title">Mood Tracker</h1>
                  <p className="page-sub">Track patterns over time</p>
                </div>
              </header>

              <div className="mood-page-content">
                <div className="mood-grid">
                  <div className="card">
                    <div className="card-title">Log today&apos;s mood</div>
                    <div className="mood-row mood-row-tracker">
                      {MOODS.map((mood) => (
                        <button
                          key={mood.value}
                          className={`mood-btn ${trackerMood === mood.value ? 'selected' : ''}`}
                          onClick={() => setTrackerMood(mood.value)}
                          type="button"
                        >
                          {mood.badge}
                          <span>{mood.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="card-title secondary-title">What&apos;s contributing?</div>
                    <div className="tag-row">
                      {TAGS.map((tag) => (
                        <button
                          key={tag}
                          className={`tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
                          onClick={() => toggleTag(tag)}
                          type="button"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>

                    <button className="primary-btn" type="button" onClick={logMood} disabled={isMoodSaving}>
                      {isMoodSaving ? 'Saving...' : 'Save Mood'}
                    </button>
                    <p className="status-note">{moodStatus}</p>
                  </div>

                  <div className="stats-column">
                    <div className="stat-card">
                      <div className="stat-kicker">Average</div>
                      <div className="stat-average">
                        <span className="stat-emoji">{averageMood.badge}</span>
                        <div>
                          <div className="stat-val">{moodAverage ? moodAverage.toFixed(1) : '0.0'}</div>
                          <div className="stat-lbl">{averageMood.label}</div>
                        </div>
                      </div>
                    </div>

                    <div className="stat-card">
                      <div className="stat-kicker">Total entries</div>
                      <div className="stat-val">{moodEntries.length}</div>
                      <div className="stat-lbl">mood check-ins</div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-title">Mood over time, last 14 days</div>
                  <div className="chart-bars">
                    {recentMoodEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className={`bar ${index === recentMoodEntries.length - 1 ? 'today' : ''}`}
                        style={{ height: `${Math.round((Number(entry.mood_value) / 5) * 100)}%` }}
                        title={entry.tags.join(', ') || 'No tags'}
                      />
                    ))}
                  </div>
                  <div className="chart-labels">
                    <span>14 days ago</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activePage === 'history' && (
            <section className="page active-page">
              <header className="page-header">
                <div>
                  <h1 className="page-title">Session History</h1>
                  <p className="page-sub">Stored Gemini conversations from Supabase</p>
                </div>
              </header>

              <div className="history-content">
                {sessionList.length === 0 && (
                  <div className="card">
                    <div className="card-title">No sessions yet</div>
                    <p className="status-note">Start a conversation in the Session tab to create your first stored chat.</p>
                  </div>
                )}

                {sessionList.map((item) => {
                  const isOpen = openSessions[item.id];
                  const moodLabel = MOODS.find((mood) => mood.value === item.initial_mood_value)?.label || 'Unknown';
                  const sessionMeta = `${new Date(item.started_at).toLocaleString()} | ${item.messages.length} messages | ${moodLabel}`;

                  return (
                    <article key={item.id} className={`session-card ${isOpen ? 'open' : ''}`}>
                      <button className="session-toggle" type="button" onClick={() => toggleSession(item.id)}>
                        <div className="session-row">
                          <div className="session-icon">Log</div>
                          <div className="session-copy">
                            <div className="session-title">{item.title}</div>
                            <div className="session-meta">{sessionMeta}</div>
                          </div>
                          <span className={`session-chevron ${isOpen ? 'open' : ''}`}>V</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="session-msgs">
                          <button className="btn-sm history-open-btn" type="button" onClick={() => loadSessionMessages(item.id)}>
                            Open session
                          </button>
                          {item.messages.map((message, index) => (
                            <div
                              key={`${item.id}-${message.sequence_no || index}`}
                              className={`hist-bubble ${message.role === 'user' ? 'user' : 'ai'}`}
                            >
                              {message.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {activePage === 'exercises' && (
            <section className="page active-page">
              <header className="page-header">
                <div>
                  <h1 className="page-title">Guided Exercises</h1>
                  <p className="page-sub">Evidence-based tools for anxiety and stress</p>
                </div>
              </header>

              <div className="exercises-content">
                <div className="ex-grid">
                  {EXERCISES.map((exercise) => (
                    <button
                      key={exercise.id}
                      className="ex-card"
                      type="button"
                      onClick={exercise.id === 'box' ? openBreathing : undefined}
                    >
                      <div className={`ex-icon ${exercise.accent}`}>{exercise.icon}</div>
                      <div className="ex-title">{exercise.title}</div>
                      <div className={`ex-sub ${exercise.accent}`}>{exercise.subtitle}</div>
                      <div className="ex-desc">Structured technique for stress regulation and emotional reset.</div>
                      <div className={`ex-link ${exercise.accent}`}>Start exercise -&gt;</div>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>

        {isBreathingOpen && (
          <div className="modal-bg" onClick={closeBreathing} role="presentation">
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <button className="close-btn" type="button" onClick={closeBreathing} aria-label="Close">
                X
              </button>
              <div className="modal-title">Box Breathing</div>
              <div className="modal-sub">Calm your nervous system</div>
              <div className="breath-ring">
                <svg width="160" height="160" className="ring-svg" aria-hidden="true">
                  <circle cx="80" cy="80" r="70" fill="none" stroke="var(--border-muted)" strokeWidth="5" />
                  <circle
                    cx="80"
                    cy="80"
                    r="70"
                    fill="none"
                    stroke="#7d9b76"
                    strokeWidth="5"
                    strokeDasharray="439.8"
                    strokeDashoffset={ringOffset}
                    strokeLinecap="round"
                    className="ring-progress"
                  />
                </svg>
                <div className="breath-inner">
                  <div className="breath-phase">{breathingFinished ? 'Done' : phase.label}</div>
                  <div className="breath-count">{countdown}</div>
                </div>
              </div>
              <div className="breath-inst">{breathingFinished ? 'Great job. Notice how you feel.' : phase.instruction}</div>
              <div className="cycle-label">Cycle {breathCycle} of 4</div>
              <button className="start-btn" type="button" onClick={toggleBreathing}>
                {breathingFinished ? 'Close' : breathRunning ? 'Pause' : breathTick > 0 ? 'Resume' : 'Begin'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconBase({ children }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {children}
    </svg>
  );
}

function ChatIcon() {
  return <IconBase><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></IconBase>;
}

function PulseIcon() {
  return <IconBase><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></IconBase>;
}

function BookIcon() {
  return <IconBase><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></IconBase>;
}

function HeartIcon() {
  return <IconBase><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></IconBase>;
}

export default App;
