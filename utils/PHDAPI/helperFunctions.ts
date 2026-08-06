import moment from "moment";
import { DateTimeFormat } from "../../constants/DateTimeFormats";

export const getPreviousDayDate = () =>
  moment().subtract(1, "days").startOf("day").toDate();

export const getPreviousDayTime = () =>
  moment().subtract(1, "days").startOf("day").format(DateTimeFormat);
