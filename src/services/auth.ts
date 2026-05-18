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

  constructor() {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');
    if (savedUser && savedToken) {
      this.user = JSON.parse(savedUser);
      this.token = savedToken;
    }
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
    this.user = data.user;
    this.token = data.session?.access_token || 'dummy_token'; // Supabase access token
    
    localStorage.setItem('user', JSON.stringify(this.user));
    localStorage.setItem('token', this.token || '');
    
    return data;
  }

  async signup(email: string, password: string, name: string, phone: string) {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, phone })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao criar conta');
    }

    const data = await res.json();

    // Atualiza a instância singleton (não só o localStorage) para que
    // isLoggedIn() reconheça a sessão imediatamente após o cadastro,
    // permitindo o redirect direto para /payment sem passar pelo login.
    if (data?.session?.access_token && data?.user) {
      this.user = data.user;
      this.token = data.session.access_token;
      localStorage.setItem('user', JSON.stringify(this.user));
      localStorage.setItem('token', this.token || '');
    }

    return data;
  }

  logout() {
    this.user = null;
    this.token = null;
    localStorage.removeItem('user');
    localStorage.removeItem('token');
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
