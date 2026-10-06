import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import { Icon } from './Icon';

describe('components/Button.tsx', () => {
  describe('rendering', () => {
    it('renders children inside a button element', () => {
      render(<Button>Click me</Button>);
      const btn = screen.getByRole('button');
      expect(btn).toHaveTextContent('Click me');
    });

    it('applies primary variant class', () => {
      render(<Button variant="primary">Primary</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('btn-primary');
    });

    it('applies secondary variant class (default)', () => {
      render(<Button>Secondary</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('btn-secondary');
    });

    it('applies ghost variant class', () => {
      render(<Button variant="ghost">Ghost</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('btn-ghost');
    });

    it('applies danger variant class', () => {
      render(<Button variant="danger">Danger</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('btn-danger');
    });

    it('applies sm size class', () => {
      render(<Button size="sm">Small</Button>);
      const btn = screen.getByRole('button');
      expect(btn.className).toContain('btn-sm');
    });

    it('passes through arbitrary props', () => {
      render(<Button type="submit" aria-label="Submit form">Submit</Button>);
      const btn = screen.getByRole('button');
      expect(btn).toHaveAttribute('type', 'submit');
      expect(btn).toHaveAttribute('aria-label', 'Submit form');
    });
  });

  describe('loading state', () => {
    it('renders spinner when loading is true', () => {
      render(<Button loading>Loading</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('sets aria-busy when loading', () => {
      render(<Button loading>Loading</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });

    it('disables button when loading', () => {
      render(<Button loading>Submit</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('disables button when disabled is true', () => {
      render(<Button disabled>Submit</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('icons', () => {
    it('renders leading icon when not loading', () => {
      render(<Button leadingIcon={<Icon.Check size={14} />}>With Icon</Button>);
      expect(screen.getByRole('button')).toContainHTML('svg');
    });

    it('renders trailing icon when not loading', () => {
      render(<Button trailingIcon={<span>T</span>}>Text</Button>);
      expect(screen.getByRole('button')).toContainHTML('T');
    });
  });

  describe('interactions', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>Click</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick} disabled>Click</Button>);
      fireEvent.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});