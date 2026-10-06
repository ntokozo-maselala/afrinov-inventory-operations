import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './Alert';

describe('components/Alert.tsx', () => {
  describe('rendering by tone', () => {
    it('renders danger alert with alert role', () => {
      render(<Alert tone="danger" title="Error">Something went wrong</Alert>);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Error');
      expect(alert).toHaveTextContent('Something went wrong');
    });

    it('renders warning alert with alert role', () => {
      render(<Alert tone="warning" title="Warning">Be careful</Alert>);
      expect(screen.getByRole('alert')).toHaveTextContent('Warning');
    });

    it('renders success alert with status role', () => {
      render(<Alert tone="success" title="Success">All good</Alert>);
      expect(screen.getByRole('status')).toHaveTextContent('Success');
    });

    it('renders info alert with status role', () => {
      render(<Alert tone="info" title="Info">For your attention</Alert>);
      expect(screen.getByRole('status')).toHaveTextContent('Info');
    });

    it('defaults to info tone', () => {
      render(<Alert title="Default">Content</Alert>);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('content', () => {
    it('renders title and children', () => {
      render(<Alert tone="info" title="Heads up">Detailed description here</Alert>);
      const alert = screen.getByRole('status');
      expect(alert).toHaveTextContent('Heads up');
      expect(alert).toHaveTextContent('Detailed description here');
    });

    it('renders title only without children', () => {
      render(<Alert tone="danger" title="Error" />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('danger and warning tones use role="alert"', () => {
      const { unmount } = render(<Alert tone="danger" title="Error" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      unmount();

      render(<Alert tone="warning" title="Warning" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});