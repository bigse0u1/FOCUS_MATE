/**
 * 앱 진입점: Vision → Metrics → State → Main 초기화
 */
import { Vision } from "./vision/index";
import "./metrics/index";
import "./state/index";
import "./main";

const vision = new Vision();
vision.start();
