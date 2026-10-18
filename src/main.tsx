import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app";
import "./styles.css";

registerSW({ immediate: true });
render(<App />, document.getElementById("app")!);
