import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@base-ui/react/button";
import { Checkbox } from "@base-ui/react/checkbox";
import { Collapsible } from "@base-ui/react/collapsible";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Input } from "@base-ui/react/input";
import { Menu } from "@base-ui/react/menu";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { Select } from "@base-ui/react/select";
import { Separator } from "@base-ui/react/separator";
import { Toggle } from "@base-ui/react/toggle";
// @ts-expect-error The shared Astro/browser initializer is intentionally a plain JS module.
import { initFieldOverflow } from "../../lib/fieldOverflow.js";
import "./base-ui.css";

type ExampleProps = { kind: string };

const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(" ");


function DemoField({
  label,
  children,
  name,
  invalid,
}: {
  label: string;
  children: ReactNode;
  name?: string;
  invalid?: boolean;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  useEffect(() => fieldRef.current ? initFieldOverflow(fieldRef.current, { manageMarkup: false }) : undefined, []);
  return (
    <Field.Root ref={fieldRef} className="dev-field base-ui-field" name={name} invalid={invalid}>
      <Field.Label className="dev-field__label base-ui-label">{label}</Field.Label>
      <div className="dev-field__value">{typeof children === "string" ? <span className="dev-field__overflow-content" data-field-overflow>{children}</span> : children}</div>
      <Field.Error className="base-ui-error" />
    </Field.Root>
  );
}

function BaseTextInput({ prefix, className, ...props }: { prefix?: string } & ComponentProps<typeof Input>) {
  return (
    <div className={cx("dev-text-field", prefix ? "dev-text-field--prefix" : "dev-text-field--native")}>
      <div className="dev-text-field__track">
        <div className="dev-text-field__content">
          {prefix && <span className="dev-text-field__prefix" aria-hidden="true">{prefix}</span>}
          <Input {...props} className={cx("dev-field__input", "base-ui-control", typeof className === "string" ? className : undefined)} />
        </div>
      </div>
      <span className="dev-text-field__measure" aria-hidden="true" />
    </div>
  );
}

function ButtonDemo() {
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState(true);
  return (
    <div className="base-ui-stack">
      <div className="base-ui-row base-ui-row--wrap">
        {(["ghost", "soft", "filled", "page", "danger"] as const).map(
          (variant) => (
            <Button
              key={variant}
              className={cx("dev-btn", `dev-btn--${variant}`)}
              onClick={() => setCount((value) => value + 1)}
            >
              {variant[0].toUpperCase() + variant.slice(1)}
            </Button>
          ),
        )}
      </div>
      <div className="base-ui-row base-ui-row--wrap">
        <Button className="dev-btn dev-btn--soft" disabled>
          Disabled
        </Button>
        <Toggle
          className={cx("dev-btn", "dev-btn--soft", selected && "is-selected")}
          pressed={selected}
          onPressedChange={setSelected}
        >
          Selected
        </Toggle>
      </div>
      <span className="base-ui-status" aria-live="polite">
        Clicked {count} times
      </span>
    </div>
  );
}

function ChoiceDemo({
  values,
  initial,
  label,
}: {
  values: string[];
  initial: string;
  label: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="base-ui-stack">
      <RadioGroup
        className="dev-segmented base-ui-radio-group"
        value={value}
        onValueChange={setValue}
        aria-label={label}
      >
        {values.map((item) => (
          <Radio.Root
            key={item}
            value={item}
            nativeButton
            render={
              <button
                type="button"
                className="dev-btn dev-btn--ghost dev-btn--fill base-ui-radio__control"
              />
            }
          >
            {item}
          </Radio.Root>
        ))}
      </RadioGroup>
      <span className="base-ui-status" aria-live="polite">
        Selected: {value}
      </span>
    </div>
  );
}

function FieldDemo({ area = false }: { area?: boolean }) {
  const [submitted, setSubmitted] = useState("");
  if (area)
    return (
      <div className="base-ui-stack">
        <DemoField label="Notes" name="notes">
          <Field.Control
            render={
              <textarea
                className="dev-field__input dev-field__input--area base-ui-control"
                rows={3}
                defaultValue={
                  "First line of notes.\nSecond line with a bit more detail.\nThird line."
                }
              />
            }
          />
        </DemoField>
        <DemoField label="Disabled">
          <Field.Control
            render={
              <textarea
                className="dev-field__input dev-field__input--area base-ui-control"
                disabled
                value="Unavailable"
                readOnly
              />
            }
          />
        </DemoField>
      </div>
    );
  return (
    <Form
      className="base-ui-stack"
      onFormSubmit={(values) =>
        setSubmitted(
          `Submitted locally: ${String(values["project-name"] ?? "")}`,
        )
      }
    >
      <DemoField label="Project name" name="project-name">
        <BaseTextInput required />
      </DemoField>
      <DemoField label="Disabled sample">
        <BaseTextInput
          disabled
          value="Read only"
        />
      </DemoField>
      <DemoField label="Read-only value">A deliberately long read-only field value for reviewing shared overflow fades at both edges.</DemoField>
      <div className="base-ui-row">
        <Button className="dev-btn dev-btn--filled" type="submit">
          Submit
        </Button>
        <Button
          className="dev-btn dev-btn--ghost"
          type="reset"
          onClick={() => setSubmitted("")}
        >
          Reset
        </Button>
        <span className="base-ui-status" aria-live="polite">
          {submitted}
        </span>
      </div>
    </Form>
  );
}

function TextFieldDemo() {
  return (
    <div className="base-ui-stack">
      <DemoField label="Normal">
        <BaseTextInput
          defaultValue="Project name"
        />
      </DemoField>
      <DemoField label="Prefixed">
        <BaseTextInput prefix="example.com/" defaultValue="project-name" />
      </DemoField>
      <DemoField label="Disabled">
        <BaseTextInput
          disabled
          value="Unavailable"
        />
      </DemoField>
    </div>
  );
}

function SelectDemo() {
  const [value, setValue] = useState("draft");
  const [submitted, setSubmitted] = useState("");
  return (
    <form
      className="base-ui-stack"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(
          `Submitted: ${new FormData(event.currentTarget).get("status") ?? ""}`,
        );
      }}
      onReset={() => {
        setValue("draft");
        setSubmitted("");
      }}
    >
      <DemoField label="Status">
        <Select.Root
          name="status"
          items={[
            { label: "Draft", value: "draft" },
            { label: "Published", value: "published" },
            { label: "Archived", value: "archived" },
            {
              label: "A deliberately long project status for overflow review",
              value: "long",
            },
          ]}
          value={value}
          onValueChange={(next) => next && setValue(next)}
        >
          <Select.Trigger className="dev-field__input dev-field__input--select dev-select__trigger base-ui-control">
            <Select.Value className="base-ui-select-value dev-select__trigger-label" />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner
              className="base-ui-select-positioner"
              alignItemWithTrigger
            >
              <Select.Popup className="base-ui-select-popup">
                <Select.List>
                  <Select.Group className="base-ui-select-group">
                    <Select.GroupLabel className="base-ui-select-group-label">
                      Active
                    </Select.GroupLabel>
                    {[
                      ["Draft", "draft"],
                      ["Published", "published"],
                    ].map(([label, item]) => (
                      <Select.Item
                        key={item}
                        value={item}
                        className="base-ui-select-item"
                      >
                        <Select.ItemText className="base-ui-select-item__text">{label}</Select.ItemText>
                        <Select.ItemIndicator aria-hidden="true">✓</Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Group>
                  <Select.Group className="base-ui-select-group">
                    <Select.GroupLabel className="base-ui-select-group-label">
                      Other
                    </Select.GroupLabel>
                    {[
                      ["Archived", "archived"],
                      [
                        "A deliberately long project status for overflow review",
                        "long",
                      ],
                    ].map(([label, item]) => (
                      <Select.Item
                        key={item}
                        value={item}
                        className="base-ui-select-item"
                      >
                        <Select.ItemText className="base-ui-select-item__text">{label}</Select.ItemText>
                        <Select.ItemIndicator aria-hidden="true">✓</Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </DemoField>
      <DemoField label="Disabled">
        <Select.Root
          items={[{ label: "Draft", value: "draft" }]}
          disabled
          defaultValue="draft"
        >
          <Select.Trigger className="dev-field__input dev-field__input--select dev-select__trigger base-ui-control">
            <Select.Value className="base-ui-select-value dev-select__trigger-label" />
          </Select.Trigger>
        </Select.Root>
      </DemoField>
      <div className="base-ui-row">
        <Button className="dev-btn dev-btn--filled" type="submit">
          Submit
        </Button>
        <Button className="dev-btn dev-btn--ghost" type="reset">
          Reset
        </Button>
        <span className="base-ui-status" aria-live="polite">
          {submitted || `Selected: ${value}`}
        </span>
      </div>
    </form>
  );
}

function ToggleDemo() {
  return (
    <div className="base-ui-stack">
      {[
        ["Unchecked", false],
        ["Checked", true],
        ["Disabled", false],
      ].map(([label, checked]) => (
        <label className="base-ui-checkbox" key={String(label)}>
          <Checkbox.Root
            className="base-ui-checkbox__root"
            defaultChecked={Boolean(checked)}
            disabled={label === "Disabled"}
          >
            <Checkbox.Indicator className="base-ui-checkbox__indicator" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M3.5 8.5l3 3 6-6" /></svg>
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function PanelActionsDemo() {
  const [status, setStatus] = useState("");
  return (
    <div className="base-ui-stack">
      <div className="dev-panel-actions base-ui-row">
        <Button
          className="dev-btn dev-btn--ghost"
          onClick={() => setStatus("Cancelled")}
        >
          Cancel
        </Button>
        <Button
          className="dev-btn dev-btn--ghost"
          onClick={() => setStatus("Reverted")}
        >
          Revert
        </Button>
        <Button
          className="dev-btn dev-btn--filled"
          onClick={() => setStatus("Saved locally")}
        >
          Save
        </Button>
      </div>
      <span className="base-ui-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

function OverlayDemo() {
  return (
    <Collapsible.Root className="base-ui-collapsible" defaultOpen>
      <Collapsible.Trigger className="dev-btn dev-btn--ghost">
        Minimize / restore
      </Collapsible.Trigger>
      <Collapsible.Panel className="base-ui-collapsible__panel">
        <div className="dev-panel dev-surface">
          <div className="dev-panel__header">
            <p className="dev-panel__title">Panel title</p>
          </div>
          <div className="dev-panel__body">
            <label className="base-ui-checkbox">
              <Checkbox.Root className="base-ui-checkbox__root" defaultChecked>
                <Checkbox.Indicator className="base-ui-checkbox__indicator" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M3.5 8.5l3 3 6-6" /></svg>
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span>Show caption</span>
            </label>
          </div>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function DialogDemo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="dev-btn dev-btn--filled">
        Open dialog
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-ui-dialog-backdrop" />
        <Dialog.Popup className="base-ui-dialog-popup">
          <Dialog.Title className="dev-panel__title">
            Base UI dialog
          </Dialog.Title>
          <Dialog.Description className="base-ui-note">
            An exploratory dialog pattern for the comparison page.
          </Dialog.Description>
          <DemoField label="Label">
            <BaseTextInput />
          </DemoField>
          <Dialog.Close className="dev-btn dev-btn--ghost">Close</Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MenuDemo() {
  const [status, setStatus] = useState("");
  return (
    <div className="base-ui-stack">
      <Menu.Root>
        <Menu.Trigger className="dev-btn dev-btn--soft">Actions</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="base-ui-menu-positioner">
            <Menu.Popup className="base-ui-menu-popup">
              <Menu.Item
                className="base-ui-menu-item"
                onClick={() => setStatus("Renamed")}
              >
                Rename
              </Menu.Item>
              <Menu.Item className="base-ui-menu-item" disabled>
                Disabled action
              </Menu.Item>
              <Menu.Item
                className="base-ui-menu-item"
                onClick={() => setStatus("Deleted")}
              >
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <span className="base-ui-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

export default function BaseUiExample({ kind }: ExampleProps) {
  switch (kind) {
    case "button":
      return <ButtonDemo />;
    case "segmented-control":
      return (
        <ChoiceDemo
          values={["Left", "Centre", "Right"]}
          initial="Left"
          label="Alignment"
        />
      );
    case "viewport-selector":
      return (
        <ChoiceDemo
          values={["Desktop", "Tablet", "Mobile"]}
          initial="Desktop"
          label="Display width"
        />
      );
    case "field":
      return <FieldDemo />;
    case "text-field":
      return <TextFieldDemo />;
    case "text-area":
      return <FieldDemo area />;
    case "select-field":
      return <SelectDemo />;
    case "toggle-row":
      return <ToggleDemo />;
    case "panel-actions":
      return <PanelActionsDemo />;
    case "badge":
      return (
        <div className="base-ui-row">
          <span className="dev-badge">On page</span>
          <span className="dev-badge">Library</span>
          <span className="dev-badge">Draft</span>
        </div>
      );
    case "hairline":
      return (
        <div className="base-ui-stack">
          <span>Line above</span>
          <Separator className="dev-hairline" aria-hidden="true" />
          <span>Line below</span>
          <div className="base-ui-hairlines"><span>Left</span><Separator
            className="dev-hairline dev-hairline--vertical"
            orientation="vertical"
            aria-hidden="true"
          />
          <span>Right</span></div>
        </div>
      );
    case "dev-panel":
      return (
        <div className="dev-panel dev-surface">
          <div className="dev-panel__header">
            <p className="dev-panel__title">Panel title</p>
          </div>
          <div className="dev-panel__body">
            <label className="base-ui-checkbox">
              <Checkbox.Root className="base-ui-checkbox__root" defaultChecked>
                <Checkbox.Indicator className="base-ui-checkbox__indicator" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M3.5 8.5l3 3 6-6" /></svg>
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span>Show caption</span>
            </label>
          </div>
        </div>
      );
    case "dev-panel-title":
      return <div className="base-ui-stack">{["Image", "Caption", "Grid"].map(title => <p key={title} className="dev-overlay__title">{title}</p>)}</div>;
    case "dev-overlay":
      return <OverlayDemo />;
    case "dialog":
      return <DialogDemo />;
    case "menu":
      return <MenuDemo />;
    default:
      return null;
  }
}
