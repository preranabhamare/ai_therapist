import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./lib/supabase', () => ({
  hasSupabaseConfig: false,
  supabase: null,
}));

test('renders auth screen when not signed in', () => {
  render(<App />);
  expect(screen.getByText('Continue with your calm space.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
});
