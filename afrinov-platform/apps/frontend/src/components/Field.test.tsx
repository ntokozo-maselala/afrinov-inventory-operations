import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, Input, Select, Textarea } from './Field';

describe('components/Field.tsx', () => {
  describe('Field', () => {
    it('renders label with correct htmlFor', () => {
      render(<Field label="Email" htmlFor="email-input"><input id="email-input" /></Field>);
      const label = screen.getByText('Email') as HTMLLabelElement;
      expect(label.htmlFor).toBe('email-input');
    });

    it('shows required indicator when required is set', () => {
      render(<Field label="Email" htmlFor="email" required><input id="email" /></Field>);
      const label = screen.getByText('Email') as HTMLLabelElement;
      expect(label.className).toContain('field-required');
    });

    it('renders help text when no error', () => {
      render(<Field label="Name" htmlFor="name" help="Enter your full name"><input id="name" /></Field>);
      expect(screen.getByText('Enter your full name')).toBeInTheDocument();
    });

    it('renders error message instead of help when error is set', () => {
      render(<Field label="Name" htmlFor="name" error="Name is required" help="Enter your name"><input id="name" /></Field>);
      expect(screen.getByText('Name is required')).toBeInTheDocument();
      expect(screen.queryByText('Enter your name')).not.toBeInTheDocument();
    });

    it('error has role="alert"', () => {
      render(<Field htmlFor="name" error="Error message"><input id="name" /></Field>);
      expect(screen.getByRole('alert')).toHaveTextContent('Error message');
    });

    it('renders without label', () => {
      render(<Field htmlFor="name"><input id="name" /></Field>);
      expect(screen.queryByRole('label')).not.toBeInTheDocument();
    });

    it('renders children', () => {
      render(<Field htmlFor="name"><span data-testid="child">Child</span></Field>);
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });
  });

  describe('Input', () => {
    it('renders input element with provided props', () => {
      render(<Input id="test" placeholder="Enter text" />);
      const input = screen.getByPlaceholderText('Enter text');
      expect(input).toHaveAttribute('id', 'test');
    });

    it('applies error class when invalid', () => {
      render(<Input invalid id="test" />);
      const input = screen.getByRole('textbox');
      expect(input.className).toContain('input-error');
    });

    it('does not apply error class when valid', () => {
      render(<Input id="test" />);
      const input = screen.getByRole('textbox');
      expect(input.className).not.toContain('input-error');
    });

    it('passes through type prop', () => {
      render(<Input type="email" id="test" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('type', 'email');
    });

    it('passes through other standard input props', () => {
      render(<Input id="test" maxLength={50} required />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('maxlength', '50');
      expect(input).toBeRequired();
    });
  });

  describe('Textarea', () => {
    it('renders textarea element', () => {
      render(<Textarea id="notes" placeholder="Enter notes" />);
      const textarea = screen.getByPlaceholderText('Enter notes');
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('applies error class when invalid', () => {
      render(<Textarea invalid id="notes" />);
      const textarea = screen.getByRole('textbox');
      expect(textarea.className).toContain('input-error');
    });
  });

  describe('Select', () => {
    it('renders select element with options', () => {
      render(
        <Select id="category">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      );
      const select = screen.getByRole('combobox');
      expect(select).toHaveAttribute('id', 'category');
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('applies error class when invalid', () => {
      render(
        <Select id="cat" invalid>
          <option value="a">A</option>
        </Select>
      );
      const select = screen.getByRole('combobox');
      expect(select.className).toContain('input-error');
    });
  });
});