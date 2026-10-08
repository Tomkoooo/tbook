// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Field, Input, Select } from "./field";

describe("Field", () => {
  it("associates its label with the control", () => {
    render(
      <Field label="Search" htmlFor="search">
        <Input id="search" />
      </Field>,
    );
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
  });

  it("shows a hint when there is no error", () => {
    render(
      <Field label="Search" hint="Name or email">
        <Input />
      </Field>,
    );
    expect(screen.getByText("Name or email")).toBeInTheDocument();
  });

  it("shows the error instead of the hint, announced as an alert", () => {
    render(
      <Field label="Search" hint="Name or email" error="Too long">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Too long");
    expect(screen.queryByText("Name or email")).not.toBeInTheDocument();
  });
});

describe("Input", () => {
  it("accepts typing", async () => {
    render(<Input aria-label="Code" />);
    await userEvent.type(screen.getByLabelText("Code"), "tok-123");
    expect(screen.getByLabelText("Code")).toHaveValue("tok-123");
  });

  it("forwards a ref, which the check-in scanner needs to re-focus the field", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="Code" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});

describe("Select", () => {
  it("renders a placeholder as an empty-valued option plus the options", () => {
    render(
      <Select
        aria-label="Status"
        placeholder="Any status"
        options={[
          { value: "paid", label: "paid" },
          { value: "pending", label: "pending" },
        ]}
      />,
    );
    expect(screen.getByRole("option", { name: "Any status" })).toHaveValue("");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("omits the placeholder option when none is given", () => {
    render(<Select aria-label="Status" options={[{ value: "paid", label: "paid" }]} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
