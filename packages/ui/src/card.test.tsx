// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, Stat, StatRow } from "./card";
import { DescriptionList, Notice, PageHeader } from "./page";

describe("Card", () => {
  it("renders a heading and its body", () => {
    render(<Card title="Filters">body</Card>);
    expect(screen.getByRole("heading", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("omits the header entirely when there is no title or actions", () => {
    render(<Card>body</Card>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("Stat", () => {
  it("renders a label, value and hint", () => {
    render(
      <StatRow>
        <Stat label="Revenue" value="1 000 Ft" hint="paid + confirmed" />
      </StatRow>,
    );
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("1 000 Ft")).toBeInTheDocument();
    expect(screen.getByText("paid + confirmed")).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders the title as the page's h1", () => {
    render(<PageHeader title="Bookings" description="Every booking" />);
    expect(screen.getByRole("heading", { level: 1, name: "Bookings" })).toBeInTheDocument();
    expect(screen.getByText("Every booking")).toBeInTheDocument();
  });
});

describe("Notice", () => {
  it("announces a danger notice as an alert and anything else as a status", () => {
    const { unmount } = render(<Notice tone="danger">Nope</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("Nope");
    unmount();

    render(<Notice tone="success">Done</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Done");
  });
});

describe("DescriptionList", () => {
  it("pairs each label with its value", () => {
    render(<DescriptionList items={[{ label: "Guests", value: 2 }]} />);
    expect(screen.getByText("Guests")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
