import LoginPageClient from "../../components/Auth/LoginPageClient";
import PageTransitionWrapper from "../../components/DrawingLoader/PageTransitionWrapper";

export default function LoginPage() {
    return (
        <PageTransitionWrapper>
            <LoginPageClient />
        </PageTransitionWrapper>
    )
}