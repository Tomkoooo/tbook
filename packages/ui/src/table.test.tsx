// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, Pagination, Table } from "./table";

describe("Table", () => {
  it("renders a scrollable table with its rows", () => {
    render(
      <Table>
        <tbody>
          <tr>
            <td>Kovács Béla</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Kovács Béla")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders a title and an optional hint", () => {
    render(<EmptyState title="No bookings" hint="Try widening the range." />);
    expect(screen.getByText("No bookings")).toBeInTheDocument();
    expect(screen.getByText("Try widening the range.")).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  const href = (page: number) => `/admin/bookings?page=${page}`;

  it("renders nothing when there is a single page and no total", () => {
    const { container } = render(<Pagination page={1} pageCount={1} hrefForPage={href} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows just a summary for a single page with a total", () => {
    render(<Pagination page={1} pageCount={1} total={3} hrefForPage={href} />);
    expect(screen.getByText("3 results")).toBeInTheDocument();
  });

  it("singularizes a one-result summary", () => {
    render(<Pagination page={1} pageCount={1} total={1} hrefForPage={href} />);
    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("links to the neighbouring pages, preserving the caller's href shape", () => {
    render(<Pagination page={2} pageCount={3} hrefForPage={href} />);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/bookings?page=1");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/bookings?page=3");
  });

  it("disables Previous on the first page rather than linking to page 0", () => {
    render(<Pagination page={1} pageCount={3} hrefForPage={href} />);
    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toHaveAttribute("aria-disabled", "true");
  });

  it("disables Next on the last page", () => {
    render(<Pagination page={3} pageCount={3} hrefForPage={href} />);
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByText("Next")).toHaveAttribute("aria-disabled", "true");
  });
});
