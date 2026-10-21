import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageContainer } from './PageContainer';

describe('PageContainer main-content target', () => {
  it('exposes the page content inside a single focusable main landmark', () => {
    render(<PageContainer><h1>Stock</h1></PageContainer>);

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(within(main).getByRole('heading', { level: 1, name: 'Stock' })).toBeInTheDocument();

    main.focus();
    expect(main).toHaveFocus();
  });

  it('keeps the main landmark out of the Tab sequence while allowing focus to continue into its content', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>Before content</button>
        <PageContainer><button>Page action</button></PageContainer>
        <button>After content</button>
      </>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Before content' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Page action' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After content' })).toHaveFocus();

    screen.getByRole('main').focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Page action' })).toHaveFocus();
  });
});
