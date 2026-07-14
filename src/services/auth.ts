export interface User {
  id: string;
  email?: string;
  name?: string;
}

export interface BrokerSettings {
  id: string;
  name: string;
  phone: string;
  ai_name: string;
  broker_address: string;
}

class AuthService {
  private user: User | null = null;
  private token: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0; // epoch em segundos (expiração do access_token)
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const savedUser = sessionStorage.getItem('user');
    const savedToken = sessionStorage.getItem('token');
    if (savedUser && savedToken) {
      this.user = JSON.parse(savedUser);
      this.token = savedToken;
      this.refreshToken = sessionStorage.getItem('refresh_token');
      this.expiresAt = Number(sessionStorage.getItem('token_expires_at') || 0);
      this.scheduleRefresh();
      // O access_token do Supabase expira em ~1h; renova já se está vencido ou perto disso
      if (this.refreshToken && Date.now() / 1000 > this.expiresAt - 300) {
        this.refresh().catch(() => {});
      }
    }
  }

  private saveSession(user: any, session: any) {
    this.user = user || this.user;
    this.token = session?.access_token || null;
    this.refreshToken = session?.refresh_token || this.refreshToken;
    this.expiresAt = session?.expires_at || 0;

    sessionStorage.setItem('user', JSON.stringify(this.user));
    sessionStorage.setItem('token', this.token || '');
    if (this.refreshToken) sessionStorage.setItem('refresh_token', this.refreshToken);
    sessionStorage.setItem('token_expires_at', String(this.expiresAt));
    this.scheduleRefresh();
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    // Checa a cada 5 min; renova quando faltar menos de 10 min para expirar
    this.refreshTimer = setInterval(() => {
      if (this.refreshToken && Date.now() / 1000 > this.expiresAt - 600) {
        this.refresh().catch(() => {});
      }
    }, 5 * 60 * 1000);
  }

  async refresh() {
    if (!this.refreshToken) return;
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.refreshToken })
    });
    if (!res.ok) {
      // Refresh token revogado/expirado → sessão morreu de verdade
      if (res.status === 401) this.logout();
      return;
    }
    const data = await res.json();
    if (data?.session?.access_token) this.saveSession(data.user, data.session);
  }

  async login(email: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao fazer login');
    }

    const data = await res.json();
    this.saveSession(data.user, data.session);
    return data;
  }

  async signup(email: string, password: string, name: string, phone: string, account_type?: string) {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, phone, account_type })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao criar conta');
    }

    const data = await res.json();

    // Atualiza a instância singleton (não só o sessionStorage) para que
    // isLoggedIn() reconheça a sessão imediatamente após o cadastro,
    // permitindo o redirect direto para /payment sem passar pelo login.
    if (data?.session?.access_token && data?.user) {
      this.saveSession(data.user, data.session);
    }

    return data;
  }

  async join(code: string, name: string, phone: string, email: string, password: string) {
    const res = await fetch('/api/auth/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, phone, email, password })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao entrar na equipe');
    }

    const data = await res.json();
    if (data?.session?.access_token && data?.user) {
      this.saveSession(data.user, data.session);
    }
    return data;
  }

  logout() {
    this.user = null;
    this.token = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('token_expires_at');
    window.location.href = '/login';
  }

  getUser() {
    return this.user;
  }

  getToken() {
    return this.token;
  }

  getAuthHeaders() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'x-user-id': this.user?.id || ''
    };
  }

  isLoggedIn() {
    return !!this.user;
  }
}

export const authService = new AuthService();
