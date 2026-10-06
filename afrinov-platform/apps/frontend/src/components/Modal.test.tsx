import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal, Drawer } from './Modal';

describe('components/Modal.tsx', () => {
  describe('Modal', () => {
    it('renders nothing when closed', () => {
      const { container } = render(
        <Modal open={false} onClose={() => {}} title="Title">Content</Modal>
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders dialog when open', () => {
      render(<Modal open={true} onClose={() => {}} title="Dialog Title">Dialog content</Modal>);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Dialog Title')).toBeInTheDocument();
      expect(screen.getByText('Dialog content')).toBeInTheDocument();
    });

    it('has aria-modal and aria-labelledby', () => {
      render(<Modal open={true} onClose={() => {}} title="Title">Content</Modal>);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
    });

    it('renders description when provided', () => {
      render(<Modal open={true} onClose={() => {}} title="Title" description="Description text">Content</Modal>);
      expect(screen.getByText('Description text')).toBeInTheDocument();
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      render(<Modal open={true} onClose={onClose} title="Title">Content</Modal>);
      const backdrop = screen.getByRole('dialog').parentElement?.firstChild;
      fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key', () => {
      const onClose = vi.fn();
      render(<Modal open={true} onClose={onClose} title="Title">Content</Modal>);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('sets body overflow to hidden when open', () => {
      render(<Modal open={true} onClose={() => {}} title="Title">Content</Modal>);
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body overflow when closed', () => {
      const { unmount } = render(<Modal open={true} onClose={() => {}} title="Title">Content</Modal>);
      expect(document.body.style.overflow).toBe('hidden');
      unmount();
      expect(document.body.style.overflow).toBe('');
    });

    it('renders footer when provided', () => {
      render(
        <Modal open={true} onClose={() => {}} title="Title" footer={<button>OK</button>}>
          Content
        </Modal>
      );
      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    });
  });

  describe('Drawer', () => {
    it('renders nothing when closed', () => {
      const { container } = render(
        <Drawer open={false} onClose={() => {}} title="Title">Content</Drawer>
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders dialog when open', () => {
      render(<Drawer open={true} onClose={() => {}} title="Drawer Title">Drawer content</Drawer>);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Drawer Title')).toBeInTheDocument();
      expect(screen.getByText('Drawer content')).toBeInTheDocument();
    });

    it('has aria-modal and aria-labelledby', () => {
      render(<Drawer open={true} onClose={() => {}} title="Title">Content</Drawer>);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'drawer-title');
    });

    it('renders close button with aria-label', () => {
      const onClose = vi.fn();
      render(<Drawer open={true} onClose={onClose} title="Title">Content</Drawer>);
      const closeBtn = screen.getByLabelText('Close');
      expect(closeBtn).toBeInTheDocument();
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key', () => {
      const onClose = vi.fn();
      render(<Drawer open={true} onClose={onClose} title="Title">Content</Drawer>);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      render(<Drawer open={true} onClose={onClose} title="Title">Content</Drawer>);
      const backdrop = screen.getByRole('dialog').parentElement?.firstChild;
      fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders description when provided', () => {
      render(<Drawer open={true} onClose={() => {}} title="Title" description="Description">Content</Drawer>);
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('renders footer when provided', () => {
      render(
        <Drawer open={true} onClose={() => {}} title="Title" footer={<button>OK</button>}>
          Content
        </Drawer>
      );
      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    });
  });
});