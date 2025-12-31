import RegisterPageClient from "../../components/Auth/RegisterPageClient";
import PageTransitionWrapper from "../../components/DrawingLoader/PageTransitionWrapper";

export default function RegisterPage() {
    return (
        <PageTransitionWrapper>
            <RegisterPageClient />
        </PageTransitionWrapper>
    )
}