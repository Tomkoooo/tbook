// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Book now</Button>);
    expect(screen.getByRole("button", { name: "Book now" })).toBeInTheDocument();
  });

  it("applies the requested variant class", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button")).toHaveClass("tbook-btn-secondary");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Pay</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
