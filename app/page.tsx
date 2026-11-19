import { redirect } from "next/navigation";

// Trang chính chuyển sang /showcase
export default function Home() {
  redirect("/showcase");
}
