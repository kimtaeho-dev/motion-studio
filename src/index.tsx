/* @refresh reload */
import "./index.css";
import { render } from "solid-js/web";
import { Root } from "./router";

render(() => <Root />, document.getElementById("root")!);
